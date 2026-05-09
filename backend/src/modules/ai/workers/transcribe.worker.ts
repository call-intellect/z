import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { AudioTrack } from '@prisma/client';
import { type Job, Worker } from 'bullmq';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { MeetingsService } from '../../meetings/meetings.service';
import { S3Service } from '../../recordings/s3.service';
import { extractKeyFromUrl } from '../../recordings/s3-keys';
import { AiQueueService } from '../ai-queue.service';
import { type AiJobData, QUEUE_NAMES } from '../queues';

import { AiUsageLogService } from '../services/ai-usage-log.service';
import {
  type TranscriptIndex,
  transcriptIndexKey,
  transcriptTrackKey,
} from '../services/s3-ai-keys';
import { TypedConfigService } from '../../../common/config/index';
import { VoxService } from '../services/vox.service';

interface TrackTranscriptionResult {
  participantId: string | null;
  livekitIdentity: string;
  speakerName: string;
  s3Key: string;
  trackStartedAt: string;
  baseStartedAt: string;
}

/**
 * Worker стадии `ai.transcribe`.
 *
 *   - Тянет аудио каждой `AudioTrack` из S3.
 *   - Отправляет в Vox (submit + poll).
 *   - Сохраняет per-track json и index.json в S3.
 *   - Обновляет/создаёт `Transcript.rawIndexS3Url`.
 *   - Ставит job в `ai.merge`.
 *
 * Идемпотентность:
 *   - На входе проверяем status. Если уже `transcription_processing` или дальше — выходим.
 *   - Если `Transcript.rawIndexS3Url` уже есть — пропускаем загрузку, сразу enqueueMerge.
 */
@Injectable()
export class TranscribeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TranscribeWorker.name);
  private worker: Worker<AiJobData> | null = null;

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
      async (job) => this.process(job),
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

    // Если уже есть rawIndexS3Url — повторно не транскрибируем.
    if (meeting.transcript?.rawIndexS3Url) {
      this.logger.log(
        { meetingId },
        'transcribe: rawIndexS3Url уже есть — переходим к merge',
      );
      await this.queue.enqueueMerge(meetingId);
      return;
    }

    const audioTracks = meeting.recording?.audioTracks ?? [];
    if (audioTracks.length === 0) {
      this.logger.warn({ meetingId }, 'transcribe: нет audio-треков');
      // Без треков нет смысла продолжать. Переводим в failed.
      await this.meetings.transitionStatus(meetingId, 'failed', {
        failureReason: 'transcribe: no_audio_tracks',
        reason: 'ai:transcribe:no_tracks',
      });
      this.metrics.incMeetingFailed('transcribe');
      return;
    }

    // Базовая точка времени = минимум startedAt по всем трекам (или старт записи).
    const baseStartedAtMs = Math.min(
      ...audioTracks.map((t) => t.startedAt.getTime()),
    );
    const baseStartedAt = new Date(baseStartedAtMs);

    const indexEntries: TrackTranscriptionResult[] = [];

    for (const track of audioTracks) {
      const entry = await this.transcribeOneTrack(meetingId, track, baseStartedAt, job);
      indexEntries.push(entry);
    }

    // Сохраняем index.json.
    const indexKey = transcriptIndexKey(meetingId);
    const indexDoc: TranscriptIndex = {
      meetingId,
      tracks: indexEntries,
      generatedAt: new Date().toISOString(),
    };
    await this.s3.putJson(indexKey, indexDoc);

    // Обновляем/создаём Transcript.
    await this.prisma.transcript.upsert({
      where: { meetingId },
      create: { meetingId, rawIndexS3Url: indexKey },
      update: { rawIndexS3Url: indexKey },
    });

    // Метрика длительности всей стадии.
    this.metrics.observeAiPipelineDuration({
      stage: 'transcribe',
      type: meeting.type,
      model: this.cfg.ai.vox.model,
      seconds: (Date.now() - startedAt) / 1000,
    });

    await this.queue.enqueueMerge(meetingId);
    this.logger.log(
      { meetingId, tracks: indexEntries.length },
      'transcribe: успешно — merge поставлен',
    );
  }

  // ───────────────────────── per-track ─────────────────────────────────────

  private async transcribeOneTrack(
    meetingId: string,
    track: AudioTrack,
    baseStartedAt: Date,
    job: Job<AiJobData>,
  ): Promise<TrackTranscriptionResult> {
    const startedAt = Date.now();
    const audioKey = extractKeyFromUrl(track.audioUrl, this.cfg.s3.bucket);
    if (!audioKey) {
      throw new Error(`transcribe: пустой audio key для track ${track.id}`);
    }

    // 1. Читаем аудио из S3.
    const audio = await this.s3.getObject(audioKey);

    // 2. Submit + poll Vox.
    let voxResult;
    let success = false;
    let errorText: string | null = null;
    try {
      const submitted = await this.vox.submit(audio, {});
      voxResult = await this.vox.poll(submitted.taskId);
      success = true;
    } catch (err) {
      errorText = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      // Лог использования: provider=vox, агент=transcribe, costUsd=0.
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

    // 3. Сохраняем per-track json в S3.
    const trackKey = transcriptTrackKey(meetingId, track.livekitIdentity);
    await this.s3.putJson(trackKey, {
      meetingId,
      participantId: track.participantId,
      livekitIdentity: track.livekitIdentity,
      speakerName: track.participantName,
      trackStartedAt: track.startedAt.toISOString(),
      transcriptText: voxResult.transcriptText,
      durationSeconds: voxResult.durationSeconds,
      words: voxResult.words ?? [],
    });

    return {
      participantId: track.participantId ?? null,
      livekitIdentity: track.livekitIdentity,
      speakerName: track.participantName,
      s3Key: trackKey,
      trackStartedAt: track.startedAt.toISOString(),
      baseStartedAt: baseStartedAt.toISOString(),
    };
  }

  // ────────────────────────── failure handling ─────────────────────────────

  /**
   * BullMQ event: job упал и `attemptsMade >= attempts`. Переводим встречу в `failed`.
   */
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
