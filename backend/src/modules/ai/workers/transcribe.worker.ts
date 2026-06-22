import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
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

@Injectable()
export class TranscribeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TranscribeWorker.name);
  private worker: Worker<AiJobData> | null = null;

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
    @Optional() @Inject(LogService) private readonly logs?: LogService,
  ) {}

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
        this.pipe.meeting(
          SystemLogPipeline.TRANSCRIPTION,
          'ai.transcribe',
          job.data.meetingId,
          () => this.process(job),
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

    if (meeting.status !== 'recording_ready' && meeting.status !== 'transcription_processing') {
      this.logger.debug(
        { meetingId, status: meeting.status },
        'transcribe: статус не recording_ready/transcription_processing — пропуск',
      );
      return;
    }

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

    if (meeting.transcript) {
      const doneTracks = await this.prisma.transcriptTrack.count({
        where: { transcriptId: meeting.transcript.id },
      });
      if (doneTracks >= audioTracks.length) {
        this.logger.debug(
          { meetingId, doneTracks },
          'transcribe: все дорожки уже в БД — переходим к merge',
        );
        await this.queue.enqueueMerge(meetingId);
        return;
      }
    }

    this.logger.debug(
      {
        meetingId,
        tracksCount: audioTracks.length,
        identities: audioTracks.map((t) => t.livekitIdentity),
      },
      'transcribe: начинаем транскрипцию треков',
    );

    const baseStartedAtMs = Math.min(...audioTracks.map((t) => t.startedAt.getTime()));
    const baseStartedAt = new Date(baseStartedAtMs);

    const transcript = await this.prisma.transcript.upsert({
      where: { meetingId },
      create: { meetingId },
      update: {},
    });

    let totalWords = 0;
    let totalTextLength = 0;
    let anyFailed = false;
    const results = await this.runWithConcurrency(
      audioTracks,
      TranscribeWorker.TRACK_POOL_SIZE,
      (track, idx) =>
        this.processTrackWithLog(
          meetingId,
          transcript.id,
          track,
          baseStartedAt,
          job,
          idx,
          audioTracks.length,
        ),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') {
        totalWords += r.value.wordsCount;
        totalTextLength += r.value.textLength;
      } else {
        anyFailed = true;
      }
    }

    this.metrics.observeAiPipelineDuration({
      stage: 'transcribe',
      type: meeting.type,
      model: this.cfg.ai.vox.model,
      seconds: (Date.now() - startedAt) / 1000,
    });

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

    await this.queue.enqueueMerge(meetingId);
    this.dbLog(
      'INFO',
      'ai.transcribe.merge_enqueued',
      `transcribe: merge поставлен — ${audioTracks.length} треков, всего ${totalWords} слов`,
      { meetingId, tracks: audioTracks.length, totalWords, totalTextLength },
    );
    this.logger.debug(
      { meetingId, tracks: audioTracks.length, totalWords, totalTextLength },
      'transcribe: успешно — merge поставлен',
    );
  }

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
    const summary = await this.transcribeOneTrack(
      meetingId,
      transcriptId,
      track,
      baseStartedAt,
      job,
    );
    this.logger.debug(
      { meetingId, trackIndex: idx + 1, identity: track.livekitIdentity },
      'transcribe: трек транскрибирован',
    );
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

    const audio = await this.s3.getObject(audioKey);
    this.logger.debug(
      {
        meetingId,
        trackId: track.id,
        identity: track.livekitIdentity,
        sizeBytes: audio.byteLength,
      },
      'transcribeOneTrack: аудио прочитано из S3',
    );

    const pollOpts = {
      intervalMs: this.cfg.ai.vox.pollIntervalMs,
      maxAttempts: this.cfg.ai.vox.pollMaxAttempts,
    };

    let voxResult;
    let success = false;
    let errorText: string | null = null;
    try {
      if (track.voxTaskId) {
        this.logger.debug(
          {
            meetingId,
            trackId: track.id,
            identity: track.livekitIdentity,
            taskId: track.voxTaskId,
          },
          'transcribeOneTrack: переиспользуем сохранённый voxTaskId — poll',
        );
        try {
          voxResult = await this.vox.poll(track.voxTaskId, pollOpts);
        } catch (err) {
          this.logger.warn(
            {
              meetingId,
              trackId: track.id,
              identity: track.livekitIdentity,
              taskId: track.voxTaskId,
            },
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
          {
            meetingId,
            trackId: track.id,
            identity: track.livekitIdentity,
            taskId: submitted.taskId,
          },
          'transcribeOneTrack: Vox задача принята — сохраняем taskId и ожидаем результат',
        );
        await this.prisma.audioTrack.update({
          where: { id: track.id },
          data: { voxTaskId: submitted.taskId },
        });
        voxResult = await this.vox.poll(submitted.taskId, pollOpts);
      }
      this.logger.debug(
        {
          meetingId,
          trackId: track.id,
          identity: track.livekitIdentity,
          wordsCount: voxResult.words?.length ?? 0,
          durationSeconds: voxResult.durationSeconds,
          textLength: voxResult.transcriptText.length,
        },
        'transcribeOneTrack: Vox транскрипция получена',
      );

      const firstEmpty =
        (voxResult.words?.length ?? 0) === 0 && voxResult.transcriptText.trim().length === 0;
      if (firstEmpty) {
        const minAudioBytes = await this.cfg.getDynamic<number>(
          'transcribe.minAudioBytes',
          undefined,
          1024,
        );
        const looksBroken =
          audio.byteLength < minAudioBytes || (voxResult.durationSeconds ?? 0) <= 0;
        if (looksBroken) {
          this.logger.warn(
            {
              meetingId,
              trackId: track.id,
              identity: track.livekitIdentity,
              audioSizeBytes: audio.byteLength,
              durationSeconds: voxResult.durationSeconds ?? 0,
              minAudioBytes,
            },
            'transcribeOneTrack: пустой результат + малое/нулевое аудио — один ре-submit свежей задачи',
          );
          await this.prisma.audioTrack.update({
            where: { id: track.id },
            data: { voxTaskId: null },
          });
          const resub = await this.vox.submit(audio, {});
          await this.prisma.audioTrack.update({
            where: { id: track.id },
            data: { voxTaskId: resub.taskId },
          });
          voxResult = await this.vox.poll(resub.taskId, pollOpts);
        }
      }

      const firstNoWords =
        !firstEmpty &&
        (voxResult.words?.length ?? 0) === 0 &&
        voxResult.transcriptText.trim().length > 0;
      if (firstNoWords) {
        this.logger.warn(
          {
            meetingId,
            trackId: track.id,
            identity: track.livekitIdentity,
            speakerName: track.participantName,
            textLength: voxResult.transcriptText.length,
            durationSeconds: voxResult.durationSeconds ?? 0,
          },
          'transcribeOneTrack: COMPLETED с текстом, но БЕЗ пословных таймингов — один ре-submit свежей задачи ради word-timings',
        );
        await this.prisma.audioTrack.update({
          where: { id: track.id },
          data: { voxTaskId: null },
        });
        const resub = await this.vox.submit(audio, {});
        await this.prisma.audioTrack.update({
          where: { id: track.id },
          data: { voxTaskId: resub.taskId },
        });
        const retried = await this.vox.poll(resub.taskId, pollOpts);
        if ((retried.words?.length ?? 0) > 0) {
          voxResult = retried;
        } else {
          this.logger.warn(
            {
              meetingId,
              trackId: track.id,
              identity: track.livekitIdentity,
              speakerName: track.participantName,
            },
            'transcribeOneTrack: повтор тоже без пословных таймингов — сохраняем текст как есть (поведение/длительность нулевые)',
          );
        }
      }
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

    const finalEmpty =
      (voxResult.words?.length ?? 0) === 0 && voxResult.transcriptText.trim().length === 0;
    if (finalEmpty) {
      const durSec = voxResult.durationSeconds ?? 0;
      const reason =
        audio.byteLength < 1024 || durSec <= 0
          ? 'битое/недогруженное аудио (size≈0 или dur≈0)'
          : 'вероятно тишина (есть аудио и длительность, но речи нет)';
      this.logger.warn(
        {
          meetingId,
          trackId: track.id,
          identity: track.livekitIdentity,
          speakerName: track.participantName,
          audioSizeBytes: audio.byteLength,
          durationSeconds: durSec,
          reason,
        },
        'transcribeOneTrack: дорожка расшифровалась ПУСТОЙ — спикер исчезнет из ленты',
      );
    }

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
      segments: (voxResult.segments ?? []).map((s) => ({
        startSec: s.startSec,
        endSec: s.endSec,
        text: s.text,
      })) as unknown as Prisma.InputJsonValue,
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

  private async onJobFailed(job: Job<AiJobData> | null, err: Error): Promise<void> {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 5)) {
      return;
    }
    const meetingId = job.data.meetingId;
    try {
      await this.meetings.transitionStatus(meetingId, 'ai_failed', {
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
