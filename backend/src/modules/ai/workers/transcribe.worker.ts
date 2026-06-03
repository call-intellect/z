import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AudioTrack } from '@prisma/client';
import { type Job, Worker } from 'bullmq';


import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
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
 *   - Если у `Transcript` уже есть треки — пропускаем загрузку, сразу enqueueMerge.
 */
@Injectable()
export class TranscribeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TranscribeWorker.name);
  private worker: Worker<AiJobData> | null = null;

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
  ) {}

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
        transcript: { include: { tracks: { take: 1 } } },
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

    // Если треки уже есть в БД — повторно не транскрибируем.
    if (meeting.transcript && meeting.transcript.tracks.length > 0) {
      this.logger.log({ meetingId }, 'transcribe: треки уже в БД — переходим к merge');
      await this.queue.enqueueMerge(meetingId);
      return;
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

    for (const [idx, track] of audioTracks.entries()) {
      this.logger.debug(
        { meetingId, trackIndex: idx + 1, total: audioTracks.length, identity: track.livekitIdentity, trackId: track.id },
        'transcribe: обрабатываем трек',
      );
      await this.transcribeOneTrack(meetingId, transcript.id, track, baseStartedAt, job);
      this.logger.debug(
        { meetingId, trackIndex: idx + 1, identity: track.livekitIdentity },
        'transcribe: трек транскрибирован',
      );
    }

    // Метрика длительности всей стадии.
    this.metrics.observeAiPipelineDuration({
      stage: 'transcribe',
      type: meeting.type,
      model: this.cfg.ai.vox.model,
      seconds: (Date.now() - startedAt) / 1000,
    });

    await this.queue.enqueueMerge(meetingId);
    this.logger.log(
      { meetingId, tracks: audioTracks.length },
      'transcribe: успешно — merge поставлен',
    );
  }

  // ───────────────────────── per-track ─────────────────────────────────────

  private async transcribeOneTrack(
    meetingId: string,
    transcriptId: string,
    track: AudioTrack,
    baseStartedAt: Date,
    job: Job<AiJobData>,
  ): Promise<void> {
    const startedAt = Date.now();
    const audioKey = extractKeyFromUrl(track.audioUrl, this.cfg.s3.bucket);
    if (!audioKey) {
      throw new Error(`transcribe: пустой audio key для track ${track.id}`);
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

    // 2. Submit + poll Vox.
    let voxResult;
    let success = false;
    let errorText: string | null = null;
    try {
      const submitted = await this.vox.submit(audio, {});
      this.logger.debug(
        { meetingId, trackId: track.id, identity: track.livekitIdentity, taskId: submitted.taskId },
        'transcribeOneTrack: Vox задача принята — ожидаем результат',
      );
      voxResult = await this.vox.poll(submitted.taskId);
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

    // 3. Сохраняем в БД (TranscriptTrack).
    this.logger.debug(
      { meetingId, trackId: track.id, identity: track.livekitIdentity },
      'transcribeOneTrack: сохраняем в БД',
    );
    await this.prisma.transcriptTrack.create({
      data: {
        transcriptId,
        livekitIdentity: track.livekitIdentity,
        speakerName: track.participantName,
        participantId: track.participantId ?? null,
        trackStartedAt: track.startedAt,
        baseStartedAt,
        transcriptText: voxResult.transcriptText,
        durationSeconds: voxResult.durationSeconds,
        words: (voxResult.words ?? []) as unknown as Prisma.InputJsonValue,
      },
    });
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
