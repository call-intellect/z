import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type Job, Worker } from 'bullmq';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { MeetingsService } from '../../meetings/meetings.service';
import { transcriptMergedKey } from '../../recordings/s3-keys';
import { S3Service } from '../../recordings/s3.service';
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

@Injectable()
export class MergeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MergeWorker.name);
  private worker: Worker<AiJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiQueueService) private readonly queue: AiQueueService,
    @Inject(MeetingsService) private readonly meetings: MeetingsService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Optional()
    @Inject(CoreQueueService)
    private readonly coreQueue?: CoreQueueService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<AiJobData>(
      QUEUE_NAMES.MERGE,
      async (job) =>
        this.pipe.meeting(SystemLogPipeline.TRANSCRIPTION, 'ai.merge', job.data.meetingId, () =>
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
    this.logger.log(`MergeWorker запущен (${QUEUE_NAMES.MERGE})`);
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
      include: { transcript: { include: { tracks: true } } },
    });

    if (!meeting?.transcript || meeting.transcript.tracks.length === 0) {
      this.logger.warn({ meetingId }, 'merge: нет TranscriptTrack-ов в БД');
      return;
    }
    if (meeting.status !== 'transcription_processing' && meeting.status !== 'transcription_ready') {
      this.logger.debug(
        { meetingId, status: meeting.status },
        'merge: статус не transcription_processing/ready — пропуск',
      );
      return;
    }

    if (meeting.transcript.turns !== null) {
      this.logger.debug({ meetingId }, 'merge: turns уже в БД — analyze');
      await this.ensureMergedJsonMirror(meetingId, meeting.transcript);
      await this.queue.enqueueAnalyze(meetingId);
      await this.queue.enqueueBehaviorMetrics(meetingId);
      await this.maybeEnqueueMeetingReportFast(meetingId);
      return;
    }

    const perTrack: PerTrackWords[] = meeting.transcript.tracks.map((track) => {
      const rawWords = (track.words ?? []) as Array<{
        word: string;
        startMs: number;
        endMs: number;
      }>;
      const rawSegments = (track.segments ?? []) as Array<{
        startSec: number;
        endSec: number;
        text: string;
      }>;
      let effectiveWords: Array<{ word: string; startMs: number; endMs: number }>;
      if (rawWords.length > 0) {
        effectiveWords = rawWords;
      } else if (rawSegments.length > 0) {
        effectiveWords = rawSegments
          .filter(
            (s) => typeof s.text === 'string' && s.text.trim().length > 0 && s.endSec > s.startSec,
          )
          .map((s) => ({
            word: s.text,
            startMs: Math.round(s.startSec * 1000),
            endMs: Math.round(s.endSec * 1000),
          }));
      } else if (track.transcriptText.trim().length > 0) {
        effectiveWords = [
          {
            word: track.transcriptText,
            startMs: 0,
            endMs: Math.max(0, Math.round((track.durationSeconds ?? 0) * 1000)),
          },
        ];
      } else {
        effectiveWords = [];
      }
      return {
        speakerName: track.speakerName,
        words: effectiveWords,
        trackStartedAt: track.trackStartedAt,
        baseStartedAt: track.baseStartedAt,
        participantId: track.participantId,
        livekitIdentity: track.livekitIdentity,
      };
    });

    const dialog: DialogTurn[] = mergeWordTimestamps(perTrack);
    const totalWords = countWords(dialog);
    const totalDurationSeconds = maxEndSec(dialog);

    const roomChat: RoomChatMessage[] | null = await loadRoomChatForMerge({
      prisma: this.prisma,
      cfg: this.cfg,
      meetingId,
    });

    const mergedKey = transcriptMergedKey(meetingId);
    await this.s3.putJson(mergedKey, { meetingId, turns: dialog });
    await this.prisma.transcript.update({
      where: { meetingId },
      data: {
        turns: dialog as unknown as Prisma.InputJsonValue,
        roomChat:
          roomChat !== null ? (roomChat as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        totalWords,
        totalDurationSeconds,
        mergedS3Url: mergedKey,
      },
    });

    if (meeting.status === 'transcription_processing') {
      await this.meetings.transitionStatus(meetingId, 'transcription_ready', {
        reason: 'ai:merge:done',
      });
    }

    this.metrics.observeAiPipelineDuration({
      stage: 'merge',
      type: meeting.type,
      model: 'merger',
      seconds: (Date.now() - startedAt) / 1000,
    });

    await this.queue.enqueueAnalyze(meetingId);
    await this.queue.enqueueBehaviorMetrics(meetingId);
    await this.maybeEnqueueMeetingReportFast(meetingId);

    let cleaningEnqueued = false;
    try {
      if (meeting.tenantId) {
        const org = await this.prisma.org.findUnique({
          where: { id: meeting.tenantId },
          select: { transcriptCleaningAuto: true },
        });
        if (org?.transcriptCleaningAuto === true) {
          await this.queue.enqueueTranscriptClean(meetingId);
          cleaningEnqueued = true;
        }
      }
    } catch (err) {
      this.logger.warn(
        {
          meetingId,
          err: err instanceof Error ? err.message : String(err),
        },
        'merge: не удалось поставить ai.transcript-clean (продолжаем без cleaning)',
      );
    }

    this.logger.debug(
      {
        meetingId,
        totalWords,
        totalDurationSeconds,
        roomChatCount: roomChat?.length ?? 0,
        cleaningEnqueued,
      },
      'merge: успешно — analyze + behavior-metrics поставлены',
    );
  }

  private async ensureMergedJsonMirror(
    meetingId: string,
    transcript: { turns: unknown; mergedS3Url: string | null },
  ): Promise<void> {
    if (transcript.mergedS3Url) return;
    const mergedKey = transcriptMergedKey(meetingId);
    await this.s3.putJson(mergedKey, { meetingId, turns: transcript.turns ?? [] });
    await this.prisma.transcript.update({
      where: { meetingId },
      data: { mergedS3Url: mergedKey },
    });
    this.logger.debug({ meetingId, mergedKey }, 'merge: merged.json зеркалирован в S3 (backfill)');
  }

  private async maybeEnqueueMeetingReportFast(meetingId: string): Promise<void> {
    if (!this.cfg.knowledgeCore.meetingReportFastEnabled) {
      this.logger.debug(
        { meetingId },
        'merge: MEETING_REPORT_FAST_ENABLED=false — producer meeting-report-fast пропущен',
      );
      return;
    }
    if (!this.coreQueue) {
      this.logger.debug(
        { meetingId },
        'merge: CoreQueueService не доступен — meeting-report-fast пропущен',
      );
      return;
    }
    try {
      await this.coreQueue.enqueueMeetingReportFast(meetingId);
      this.logger.debug(
        { meetingId },
        'merge: meeting-report-fast — job поставлен в core.meeting-report-fast',
      );
    } catch (err) {
      this.logger.warn(
        {
          meetingId,
          err: err instanceof Error ? err.message : String(err),
        },
        'merge: не удалось поставить core.meeting-report-fast (продолжаем без fast-отчёта)',
      );
    }
  }

  private async onJobFailed(job: Job<AiJobData> | null, err: Error): Promise<void> {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 5)) return;
    const meetingId = job.data.meetingId;
    try {
      await this.meetings.transitionStatus(meetingId, 'ai_failed', {
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
