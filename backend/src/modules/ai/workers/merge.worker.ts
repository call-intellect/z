import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { MeetingsService } from '../../meetings/meetings.service';
import { S3Service } from '../../recordings/s3.service';
import { AiQueueService } from '../ai-queue.service';
import { type AiJobData, QUEUE_NAMES } from '../queues';

import {
  countWords,
  maxEndSec,
  mergeWordTimestamps,
  type PerTrackWords,
} from '../services/merger';
import {
  type TranscriptIndex,
  transcriptMergedKey,
} from '../services/s3-ai-keys';
import type { DialogTurn } from '../services/prompts/common';

/**
 * Worker стадии `ai.merge`.
 *
 *   1. Читает Transcript.rawIndexS3Url (index.json).
 *   2. По каждой ссылке тянет per-track json с word-timestamps.
 *   3. Склеивает в единый dialog: DialogTurn[].
 *   4. Сохраняет merged.json в S3.
 *   5. Обновляет Transcript.{mergedS3Url, totalWords, totalDurationSeconds}.
 *   6. transitionStatus → transcription_ready.
 *   7. enqueueAnalyze(meetingId).
 */
@Injectable()
export class MergeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MergeWorker.name);
  private worker: Worker<AiJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(AiQueueService) private readonly queue: AiQueueService,
    @Inject(MeetingsService) private readonly meetings: MeetingsService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<AiJobData>(
      QUEUE_NAMES.MERGE,
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
    this.logger.log(`MergeWorker запущен (${QUEUE_NAMES.MERGE})`);
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
      include: { transcript: true },
    });
    if (!meeting?.transcript?.rawIndexS3Url) {
      this.logger.warn({ meetingId }, 'merge: нет Transcript.rawIndexS3Url');
      return;
    }
    if (
      meeting.status !== 'transcription_processing' &&
      meeting.status !== 'transcription_ready'
    ) {
      this.logger.debug(
        { meetingId, status: meeting.status },
        'merge: статус не transcription_processing/ready — пропуск',
      );
      return;
    }

    // Если merged уже есть — сразу к analyze (идемпотентность).
    if (meeting.transcript.mergedS3Url) {
      this.logger.log({ meetingId }, 'merge: mergedS3Url уже есть — analyze');
      await this.queue.enqueueAnalyze(meetingId);
      return;
    }

    // 1. Читаем index.
    const index = await this.s3.getJson<TranscriptIndex>(
      meeting.transcript.rawIndexS3Url,
    );

    // 2. Тянем per-track jsons.
    const perTrack: PerTrackWords[] = [];
    for (const t of index.tracks) {
      const doc = await this.s3.getJson<{
        speakerName?: string;
        words?: Array<{ word: string; startMs: number; endMs: number }>;
        transcriptText?: string;
      }>(t.s3Key);
      const words = doc.words ?? [];
      // Если words пустой, но есть transcriptText — fallback: создаём один word
      // на весь трек, чтобы он попал в merged как один turn.
      const effectiveWords =
        words.length > 0
          ? words
          : doc.transcriptText && doc.transcriptText.trim().length > 0
            ? [{ word: doc.transcriptText, startMs: 0, endMs: 0 }]
            : [];
      perTrack.push({
        speakerName: doc.speakerName ?? t.speakerName,
        words: effectiveWords,
        trackStartedAt: new Date(t.trackStartedAt),
        baseStartedAt: new Date(t.baseStartedAt),
      });
    }

    // 3. Склейка.
    const dialog: DialogTurn[] = mergeWordTimestamps(perTrack);
    const totalWords = countWords(dialog);
    const totalDurationSeconds = maxEndSec(dialog);

    // 4. Сохраняем merged.json.
    const mergedKey = transcriptMergedKey(meetingId);
    await this.s3.putJson(mergedKey, { meetingId, turns: dialog });

    // 5. Обновляем Transcript.
    await this.prisma.transcript.update({
      where: { meetingId },
      data: {
        mergedS3Url: mergedKey,
        totalWords,
        totalDurationSeconds,
      },
    });

    // 6. FSM → transcription_ready (если ещё в processing).
    if (meeting.status === 'transcription_processing') {
      await this.meetings.transitionStatus(meetingId, 'transcription_ready', {
        reason: 'ai:merge:done',
      });
    }

    // 7. Метрика и enqueue.
    this.metrics.observeAiPipelineDuration({
      stage: 'merge',
      type: meeting.type,
      model: 'merger',
      seconds: (Date.now() - startedAt) / 1000,
    });

    await this.queue.enqueueAnalyze(meetingId);
    this.logger.log(
      { meetingId, totalWords, totalDurationSeconds },
      'merge: успешно — analyze поставлен',
    );

    void this.cfg; // suppress unused warning (нужен под conf-зависимости в будущем)
  }

  private async onJobFailed(job: Job<AiJobData> | null, err: Error): Promise<void> {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 5)) return;
    const meetingId = job.data.meetingId;
    try {
      await this.meetings.transitionStatus(meetingId, 'failed', {
        failureReason: `merge: ${err.message}`,
        reason: 'ai:merge:final_failure',
      });
      this.metrics.incMeetingFailed('merge');
    } catch (e) {
      this.logger.warn(
        `merge failed → fsm transition: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
