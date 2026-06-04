import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma, SystemLogCategory } from '@prisma/client';
import type { AudioTrack } from '@prisma/client';
import { type Job, Worker } from 'bullmq';


import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { LogService } from '../../logging/log.service';
import { MeetingsService } from '../../meetings/meetings.service';
import { extractKeyFromUrl } from '../../recordings/s3-keys';
import { S3Service } from '../../recordings/s3.service';
import { AiQueueService } from '../ai-queue.service';
import { type AiJobData, QUEUE_NAMES } from '../queues';
import { AiUsageLogService } from '../services/ai-usage-log.service';
import { VoxService } from '../services/vox.service';

/**
 * Worker стадии `ai.transcribe`.
 *
 *   - Тянет аудио каждой `AudioTrack` из S3.
 *   - Отправляет в Vox (submit + poll).
 *   - Сохраняет per-track данные в БД (TranscriptTrack).
 *   - Создаёт/обновляет `Transcript` (без S3 URL — данные в БД).
 *   - Ставит job в `ai.merge`.
 *
 * Идемпотентность:
 *   - На входе проверяем status. Если уже `transcription_processing` или дальше — выходим.
 *   - Если у `Transcript` транскрибированы ВСЕ дорожки (count == audioTracks) —
 *     пропускаем загрузку, сразу enqueueMerge. Частичный набор НЕ короткозамыкаем:
 *     проваливаемся в пул, который доделает недостающие дорожки (per-track skip).
 */
@Injectable()
export class TranscribeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TranscribeWorker.name);
  private worker: Worker<AiJobData> | null = null;

  /** Сколько дорожек транскрибируем одновременно (не перегружая Vox). */
  private static readonly TRACK_POOL_SIZE = 4;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(VoxService) private readonly vox: VoxService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(AiQueueService) private readonly queue: AiQueueService,
    @Inject(MeetingsService) private readonly meetings: MeetingsService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
    @Inject(AiUsageLogService) private readonly usage: AiUsageLogService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    // DB-логи (система логов в БД). Optional — spec'и строят воркер
    // позиционно без LogService; в рантайме резолвится (@Global LoggingModule).
    @Optional() @Inject(LogService) private readonly logs?: LogService,
  ) {}

  /** Best-effort DB-лог под модулем `ai.transcribe` (наследует traceId из ALS). */
  private dbLog(
    level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR',
    action: string,
    message: string,
    details?: unknown,
  ): void {
    this.logs?.write({
      level,
      category: SystemLogCategory.JOB,
      module: 'ai.transcribe',
      action,
      message,
      ...(details !== undefined ? { details } : {}),
    });
  }

  onModuleInit(): void {
    this.worker = new Worker<AiJobData>(
      QUEUE_NAMES.TRANSCRIBE,
      async (job) =>
        this.pipe.meeting(SystemLogPipeline.TRANSCRIPTION, 'ai.transcribe', job.data.meetingId, () =>
          this.process(job),
        ),
      {
        connection: this.redis.client,
        concurrency: 4,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.onJobFailed(job ?? null, err).catch((e) => {
        this.logger.error(`onJobFailed: ${e instanceof Error ? e.message : String(e)}`);
      });
    });
    this.logger.log(`TranscribeWorker запущен (${QUEUE_NAMES.TRANSCRIBE})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  // ─────────────────────────── core ────────────────────────────────────────

  private async process(job: Job<AiJobData>): Promise<void> {
    const { meetingId } = job.data;
    const startedAt = Date.now();

    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: {
        recording: { include: { audioTracks: true } },
        transcript: true,
      },
    });
    if (!meeting) {
      this.logger.warn({ meetingId }, 'transcribe: meeting не найден');
      return;
    }

    // Идемпотентность: если уже после `transcription_processing` — пропускаем.
    if (
      meeting.status !== 'recording_ready' &&
      meeting.status !== 'transcription_processing'
    ) {
      this.logger.debug(
        { meetingId, status: meeting.status },
        'transcribe: статус не recording_ready/transcription_processing — пропуск',
      );
      return;
    }

    // Перевод в `transcription_processing` (если ещё в `recording_ready`).
    if (meeting.status === 'recording_ready') {
      await this.meetings.transitionStatus(meetingId, 'transcription_processing', {
        reason: 'ai:transcribe:start',
      });
    }

    const audioTracks = meeting.recording?.audioTracks ?? [];
    if (audioTracks.length === 0) {
      this.logger.warn({ meetingId }, 'transcribe: нет audio-треков');
      await this.meetings.transitionStatus(meetingId, 'failed', {
        failureReason: 'transcribe: no_audio_tracks',
        reason: 'ai:transcribe:no_tracks',
      });
      this.metrics.incMeetingFailed('transcribe');
      return;
    }

    // Идемпотентность: если ВСЕ дорожки уже транскрибированы — сразу merge.
    // (Частичный набор НЕ короткозамыкаем: провалимся в пул, который по
    //  per-track идемпотентности пропустит готовые и доделает оставшиеся.
    //  Иначе при ретрае после частичного успеха — например, 2 из 3 дорожек —
    //  одна-единственная TranscriptTrack увела бы джоб в merge и недостающая
    //  дорожка не транскрибировалась бы никогда.)
    if (meeting.transcript) {
      const doneTracks = await this.prisma.transcriptTrack.count({
        where: { transcriptId: meeting.transcript.id },
      });
      if (doneTracks >= audioTracks.length) {
        this.logger.log(
          { meetingId, doneTracks },
          'transcribe: все дорожки уже в БД — переходим к merge',
        );
        await this.queue.enqueueMerge(meetingId);
        return;
      }
    }

    this.logger.debug(
      { meetingId, tracksCount: audioTracks.length, identities: audioTracks.map((t) => t.livekitIdentity) },
      'transcribe: начинаем транскрипцию треков',
    );

    // Базовая точка времени = минимум startedAt по всем трекам.
    const baseStartedAtMs = Math.min(...audioTracks.map((t) => t.startedAt.getTime()));
    const baseStartedAt = new Date(baseStartedAtMs);

    // Создаём Transcript (если нет) — треки будут добавлены ниже.
    const transcript = await this.prisma.transcript.upsert({
      where: { meetingId },
      create: { meetingId },
      update: {},
    });

    // Транскрибируем дорожки ПАРАЛЛЕЛЬНО с ограничением одновременности
    // (пул TRACK_POOL_SIZE — чтобы не перегрузить Vox). allSettled: падение
    // одной дорожки не валит остальные; успешные персистятся (upsert
    // идемпотентен), упавшие ретраятся джобом.
    let totalWords = 0;
    let totalTextLength = 0;
    let anyFailed = false;
    const results = await this.runWithConcurrency(
      audioTracks,
      TranscribeWorker.TRACK_POOL_SIZE,
      (track, idx) => this.processTrackWithLog(meetingId, transcript.id, track, baseStartedAt, job, idx, audioTracks.length),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') {
        totalWords += r.value.wordsCount;
        totalTextLength += r.value.textLength;
      } else {
        anyFailed = true;
      }
    }

    // Метрика длительности всей стадии.
    this.metrics.observeAiPipelineDuration({
      stage: 'transcribe',
      type: meeting.type,
      model: this.cfg.ai.vox.model,
      seconds: (Date.now() - startedAt) / 1000,
    });

    // Guard перед merge: считаем фактическое число TranscriptTrack'ов для
    // этого transcriptId. Если оно меньше числа audioTracks (хотя бы одна
    // дорожка упала) — НЕ ставим merge, а бросаем ошибку, чтобы BullMQ
    // ретраил джоб. Идемпотентность (voxTaskId reuse + upsert) не даст дублей.
    const persistedTracks = await this.prisma.transcriptTrack.count({
      where: { transcriptId: transcript.id },
    });
    if (persistedTracks < audioTracks.length) {
      this.dbLog(
        'WARN',
        'ai.transcribe.incomplete',
        `transcribe: транскрибированы НЕ все дорожки (${persistedTracks}/${audioTracks.length}) — merge отложен, джоб будет переотправлен`,
        { meetingId, persistedTracks, totalTracks: audioTracks.length, anyFailed },
      );
      this.logger.warn(
        { meetingId, persistedTracks, totalTracks: audioTracks.length },
        'transcribe: не все дорожки готовы — бросаем ошибку для ретрая',
      );
      throw new Error(
        `transcribe: не все дорожки транскрибированы (${persistedTracks}/${audioTracks.length})`,
      );
    }

    // Детект пустой транскрипции на уровне встречи: ни в одном треке нет ни слов,
    // ни текста. Делаем это ЗАМЕТНЫМ в БД-логах (иначе пустой транскрипт уходит
    // в merge → пустой показ + холостой прогон LLM по пустому вводу).
    if (totalWords === 0 && totalTextLength === 0) {
      this.dbLog(
        'WARN',
        'ai.transcribe.no_speech',
        `transcribe: ПУСТАЯ транскрипция — все ${audioTracks.length} треков без слов и текста (нет речи / битое аудио / mismatch ответа Vox)`,
        { meetingId, tracks: audioTracks.length },
      );
      this.logger.warn(
        { meetingId, tracks: audioTracks.length },
        'transcribe: пустая транскрипция (все треки пустые)',
      );
    }

    // Только когда ВСЕ дорожки имеют TranscriptTrack — merge ровно один раз.
    await this.queue.enqueueMerge(meetingId);
    this.dbLog(
      'INFO',
      'ai.transcribe.merge_enqueued',
      `transcribe: merge поставлен — ${audioTracks.length} треков, всего ${totalWords} слов`,
      { meetingId, tracks: audioTracks.length, totalWords, totalTextLength },
    );
    this.logger.log(
      { meetingId, tracks: audioTracks.length, totalWords, totalTextLength },
      'transcribe: успешно — merge поставлен',
    );
  }

  /**
   * Транскрибирует один трек и пишет per-track DB-лог. Обёртка над
   * `transcribeOneTrack`, чтобы лог по треку был внутри пула (не блокировал
   * остальные дорожки). Любая ошибка пробрасывается — её ловит allSettled.
   */
  private async processTrackWithLog(
    meetingId: string,
    transcriptId: string,
    track: AudioTrack,
    baseStartedAt: Date,
    job: Job<AiJobData>,
    idx: number,
    total: number,
  ): Promise<{
    speakerName: string;
    wordsCount: number;
    textLength: number;
    durationSeconds: number;
    transcriptPreview: string;
  }> {
    this.logger.debug(
      { meetingId, trackIndex: idx + 1, total, identity: track.livekitIdentity, trackId: track.id },
      'transcribe: обрабатываем трек',
    );
    const summary = await this.transcribeOneTrack(meetingId, transcriptId, track, baseStartedAt, job);
    this.logger.debug(
      { meetingId, trackIndex: idx + 1, identity: track.livekitIdentity },
      'transcribe: трек транскрибирован',
    );
    // Результат по треку в DB-логи (видно спикера, слова, текст).
    this.dbLog(
      summary.wordsCount === 0 && summary.textLength === 0 ? 'WARN' : 'INFO',
      'ai.transcribe.track',
      `transcribe: трек ${idx + 1}/${total} «${summary.speakerName}» — ${summary.wordsCount} слов, ${summary.textLength} символов`,
      {
        trackIndex: idx + 1,
        totalTracks: total,
        trackId: track.id,
        identity: track.livekitIdentity,
        speakerName: summary.speakerName,
        wordsCount: summary.wordsCount,
        textLength: summary.textLength,
        durationSeconds: summary.durationSeconds,
        transcriptPreview: summary.transcriptPreview,
      },
    );
    return summary;
  }

  /**
   * Маленький пул промисов БЕЗ внешних зависимостей. Обрабатывает `items`
   * с ограничением `poolSize` одновременных задач, возвращает результаты в
   * исходном порядке как `PromiseSettledResult` (как `Promise.allSettled`).
   */
  private async runWithConcurrency<T, R>(
    items: T[],
    poolSize: number,
    fn: (item: T, index: number) => Promise<R>,
  ): Promise<Array<PromiseSettledResult<R>>> {
    const results: Array<PromiseSettledResult<R>> = new Array(items.length);
    let next = 0;
    const workers = new Array(Math.min(Math.max(poolSize, 1), items.length))
      .fill(null)
      .map(async () => {
        for (;;) {
          const idx = next++;
          if (idx >= items.length) return;
          try {
            const value = await fn(items[idx]!, idx);
            results[idx] = { status: 'fulfilled', value };
          } catch (reason) {
            results[idx] = { status: 'rejected', reason };
          }
        }
      });
    await Promise.all(workers);
    return results;
  }

  /** Сводка результата транскрипции одного трека (для логов и агрегации). */
  private static trackSummary(
    speakerName: string,
    transcriptText: string,
    wordsCount: number,
    durationSeconds: number,
  ): {
    speakerName: string;
    wordsCount: number;
    textLength: number;
    durationSeconds: number;
    transcriptPreview: string;
  } {
    const max = 2000;
    return {
      speakerName,
      wordsCount,
      textLength: transcriptText.length,
      durationSeconds,
      transcriptPreview:
        transcriptText.length > max
          ? `${transcriptText.slice(0, max)}…[+${transcriptText.length - max}]`
          : transcriptText,
    };
  }

  // ───────────────────────── per-track ─────────────────────────────────────

  private async transcribeOneTrack(
    meetingId: string,
    transcriptId: string,
    track: AudioTrack,
    baseStartedAt: Date,
    job: Job<AiJobData>,
  ): Promise<{
    speakerName: string;
    wordsCount: number;
    textLength: number;
    durationSeconds: number;
    transcriptPreview: string;
  }> {
    const startedAt = Date.now();
    const audioKey = extractKeyFromUrl(track.audioUrl, this.cfg.s3.bucket);
    if (!audioKey) {
      throw new Error(`transcribe: пустой audio key для track ${track.id}`);
    }

    // 0. Per-track идемпотентность: если для (transcriptId, livekitIdentity)
    // уже есть TranscriptTrack — пропускаем (не качаем аудио, не дёргаем Vox).
    const existing = await this.prisma.transcriptTrack.findUnique({
      where: {
        transcriptId_livekitIdentity: { transcriptId, livekitIdentity: track.livekitIdentity },
      },
    });
    if (existing) {
      this.logger.debug(
        { meetingId, trackId: track.id, identity: track.livekitIdentity },
        'transcribeOneTrack: TranscriptTrack уже есть — пропуск',
      );
      return TranscribeWorker.trackSummary(
        existing.speakerName,
        existing.transcriptText,
        Array.isArray(existing.words) ? existing.words.length : 0,
        existing.durationSeconds,
      );
    }

    this.logger.debug(
      { meetingId, trackId: track.id, identity: track.livekitIdentity, audioKey },
      'transcribeOneTrack: читаем аудио из S3',
    );

    // 1. Читаем аудио из S3.
    const audio = await this.s3.getObject(audioKey);
    this.logger.debug(
      { meetingId, trackId: track.id, identity: track.livekitIdentity, sizeBytes: audio.byteLength },
      'transcribeOneTrack: аудио прочитано из S3',
    );

    const pollOpts = {
      intervalMs: this.cfg.ai.vox.pollIntervalMs,
      maxAttempts: this.cfg.ai.vox.pollMaxAttempts,
    };

    // 2. Submit + poll Vox. taskId сохраняем в AudioTrack.voxTaskId ДО poll —
    // при ретрае джоба не делаем повторный submit (опрос той же задачи).
    let voxResult;
    let success = false;
    let errorText: string | null = null;
    try {
      if (track.voxTaskId) {
        // Переиспользуем сохранённый taskId — продолжаем опрос той же задачи.
        this.logger.debug(
          { meetingId, trackId: track.id, identity: track.livekitIdentity, taskId: track.voxTaskId },
          'transcribeOneTrack: переиспользуем сохранённый voxTaskId — poll',
        );
        try {
          voxResult = await this.vox.poll(track.voxTaskId, pollOpts);
        } catch (err) {
          // Защита от «протухшего» taskId (4xx — задача не найдена/истекла):
          // очищаем voxTaskId и делаем свежий submit (один уровень fallback).
          this.logger.warn(
            { meetingId, trackId: track.id, identity: track.livekitIdentity, taskId: track.voxTaskId },
            `transcribeOneTrack: poll по сохранённому voxTaskId упал (${err instanceof Error ? err.message : String(err)}) — пересабмитим`,
          );
          await this.prisma.audioTrack.update({
            where: { id: track.id },
            data: { voxTaskId: null },
          });
          const resubmitted = await this.vox.submit(audio, {});
          await this.prisma.audioTrack.update({
            where: { id: track.id },
            data: { voxTaskId: resubmitted.taskId },
          });
          voxResult = await this.vox.poll(resubmitted.taskId, pollOpts);
        }
      } else {
        const submitted = await this.vox.submit(audio, {});
        this.logger.debug(
          { meetingId, trackId: track.id, identity: track.livekitIdentity, taskId: submitted.taskId },
          'transcribeOneTrack: Vox задача принята — сохраняем taskId и ожидаем результат',
        );
        // Сохраняем taskId ДО poll — чтобы ретрай переиспользовал задачу.
        await this.prisma.audioTrack.update({
          where: { id: track.id },
          data: { voxTaskId: submitted.taskId },
        });
        voxResult = await this.vox.poll(submitted.taskId, pollOpts);
      }
      this.logger.debug(
        {
          meetingId, trackId: track.id, identity: track.livekitIdentity,
          wordsCount: voxResult.words?.length ?? 0,
          durationSeconds: voxResult.durationSeconds,
          textLength: voxResult.transcriptText.length,
        },
        'transcribeOneTrack: Vox транскрипция получена',
      );
      success = true;
    } catch (err) {
      errorText = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      await this.usage.record({
        meetingId,
        agentType: 'transcribe',
        jobId: job.id ?? null,
        model: this.cfg.ai.vox.model,
        provider: 'vox',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        durationMs: Date.now() - startedAt,
        success,
        errorText,
      });
    }

    if (!voxResult) {
      throw new Error('transcribe: voxResult пуст');
    }

    // 3. Сохраняем в БД (TranscriptTrack). upsert per-track — идемпотентно по
    // (transcriptId, livekitIdentity): повтор не создаёт дублей.
    this.logger.debug(
      { meetingId, trackId: track.id, identity: track.livekitIdentity },
      'transcribeOneTrack: сохраняем в БД',
    );
    const trackData = {
      speakerName: track.participantName,
      participantId: track.participantId ?? null,
      trackStartedAt: track.startedAt,
      baseStartedAt,
      transcriptText: voxResult.transcriptText,
      durationSeconds: voxResult.durationSeconds,
      words: (voxResult.words ?? []) as unknown as Prisma.InputJsonValue,
    };
    await this.prisma.transcriptTrack.upsert({
      where: {
        transcriptId_livekitIdentity: { transcriptId, livekitIdentity: track.livekitIdentity },
      },
      create: {
        transcriptId,
        livekitIdentity: track.livekitIdentity,
        ...trackData,
      },
      update: trackData,
    });

    return TranscribeWorker.trackSummary(
      track.participantName,
      voxResult.transcriptText,
      voxResult.words?.length ?? 0,
      voxResult.durationSeconds,
    );
  }

  // ────────────────────────── failure handling ─────────────────────────────

  private async onJobFailed(job: Job<AiJobData> | null, err: Error): Promise<void> {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 5)) {
      return;
    }
    const meetingId = job.data.meetingId;
    try {
      await this.meetings.transitionStatus(meetingId, 'failed', {
        failureReason: `transcribe: ${err.message}`,
        reason: 'ai:transcribe:final_failure',
      });
      this.metrics.incMeetingFailed('transcribe');
    } catch (e) {
      this.logger.warn(
        `transcribe failed → fsm transition: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
