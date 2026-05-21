import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type Job, Worker } from 'bullmq';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { MeetingsService } from '../../meetings/meetings.service';
import { AiQueueService } from '../ai-queue.service';
import { type AiJobData, QUEUE_NAMES } from '../queues';

import {
  countWords,
  loadRoomChatForMerge,
  maxEndSec,
  mergeWordTimestamps,
  type PerTrackWords,
} from '../services/merger';
import type { DialogTurn, RoomChatMessage } from '../services/prompts/common';

/**
 * Worker стадии `ai.merge`.
 *
 *   1. Читает TranscriptTrack-и из БД (word-timestamps на трек).
 *   2. Склеивает в единый dialog: DialogTurn[].
 *   3. Сохраняет turns/roomChat/totalWords/totalDurationSeconds в Transcript (БД).
 *   4. transitionStatus → transcription_ready.
 *   5. enqueueAnalyze(meetingId).
 *
 * Идемпотентность: если Transcript.turns уже заполнен — сразу к analyze.
 */
@Injectable()
export class MergeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MergeWorker.name);
  private worker: Worker<AiJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
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
      include: { transcript: { include: { tracks: true } } },
    });

    if (!meeting?.transcript || meeting.transcript.tracks.length === 0) {
      this.logger.warn({ meetingId }, 'merge: нет TranscriptTrack-ов в БД');
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

    // Идемпотентность: turns уже склеены — сразу к analyze.
    if (meeting.transcript.turns !== null) {
      this.logger.log({ meetingId }, 'merge: turns уже в БД — analyze');
      await this.queue.enqueueAnalyze(meetingId);
      return;
    }

    // 1. Строим perTrack из DB-треков.
    const perTrack: PerTrackWords[] = meeting.transcript.tracks.map((track) => {
      const rawWords = (track.words ?? []) as Array<{ word: string; startMs: number; endMs: number }>;
      // Если words пустой, но есть transcriptText — fallback: один псевдо-word.
      const effectiveWords =
        rawWords.length > 0
          ? rawWords
          : track.transcriptText.trim().length > 0
            ? [{ word: track.transcriptText, startMs: 0, endMs: 0 }]
            : [];
      return {
        speakerName: track.speakerName,
        words: effectiveWords,
        trackStartedAt: track.trackStartedAt,
        baseStartedAt: track.baseStartedAt,
      };
    });

    // 2. Склейка.
    const dialog: DialogTurn[] = mergeWordTimestamps(perTrack);
    const totalWords = countWords(dialog);
    const totalDurationSeconds = maxEndSec(dialog);

    // 3. Подмешиваем in-meeting чат (опционально, по флагу INCLUDE_ROOM_CHAT_IN_AI).
    const roomChat: RoomChatMessage[] | null = await loadRoomChatForMerge({
      prisma: this.prisma,
      cfg: this.cfg,
      meetingId,
    });

    // 4. Сохраняем в Transcript (БД).
    await this.prisma.transcript.update({
      where: { meetingId },
      data: {
        turns: dialog as unknown as Prisma.InputJsonValue,
        roomChat: roomChat !== null ? (roomChat as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        totalWords,
        totalDurationSeconds,
      },
    });

    // 5. FSM → transcription_ready (если ещё в processing).
    if (meeting.status === 'transcription_processing') {
      await this.meetings.transitionStatus(meetingId, 'transcription_ready', {
        reason: 'ai:merge:done',
      });
    }

    // 6. Метрика и enqueue.
    this.metrics.observeAiPipelineDuration({
      stage: 'merge',
      type: meeting.type,
      model: 'merger',
      seconds: (Date.now() - startedAt) / 1000,
    });

    await this.queue.enqueueAnalyze(meetingId);
    this.logger.log(
      {
        meetingId,
        totalWords,
        totalDurationSeconds,
        roomChatCount: roomChat?.length ?? 0,
      },
      'merge: успешно — analyze поставлен',
    );
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
