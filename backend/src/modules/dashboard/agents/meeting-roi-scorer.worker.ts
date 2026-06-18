import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type Job, Worker } from 'bullmq';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { PRESENT_PARTICIPANT_WHERE } from '../../participants/participant-presence';
import { DASHBOARD_QUEUE_NAMES, type MeetingRoiJobData } from '../queues';

@Injectable()
export class MeetingRoiScorerWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MeetingRoiScorerWorker.name);
  private worker: Worker<MeetingRoiJobData> | null = null;

  static readonly WEIGHT_DECISIONS = 10;
  static readonly WEIGHT_COMMITMENTS = 5;
  static readonly WEIGHT_TASKS = 3;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<MeetingRoiJobData>(
      DASHBOARD_QUEUE_NAMES.MEETING_ROI,
      async (job) =>
        this.pipe.job(SystemLogPipeline.AI_ANALYSIS, 'dashboard.meeting-roi', job, () =>
          this.process(job),
        ),
      {
        connection: this.redis.client,
        concurrency: 4,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        {
          meetingId: job?.data?.meetingId,
          attempt: job?.attemptsMade,
          err: err?.message,
        },
        'meeting-roi-scorer: job failed (повтор по политике BullMQ)',
      );
    });
    this.logger.debug(`MeetingRoiScorerWorker запущен (${DASHBOARD_QUEUE_NAMES.MEETING_ROI})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  async process(job: Job<MeetingRoiJobData>): Promise<void> {
    const { meetingId } = job.data;
    const startedAt = Date.now();

    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: {
        id: true,
        tenantId: true,
        durationMs: true,
        startedAt: true,
        endedAt: true,
        _count: { select: { participants: { where: PRESENT_PARTICIPANT_WHERE } } },
      },
    });
    if (!meeting) {
      this.logger.warn({ meetingId }, 'meeting-roi: meeting не найден — skip');
      return;
    }

    const decisions = await this.prisma.decision.count({
      where: { sourceMeetingId: meetingId, tenantId: meeting.tenantId },
    });

    const commitments = await this.countCommitments(meetingId, meeting.tenantId);

    const tasks = await this.prisma.task.count({
      where: { meetingId, tenantId: meeting.tenantId },
    });

    const durationMs = computeDurationMs(meeting.startedAt, meeting.endedAt, meeting.durationMs);
    const durationHours = durationMs / 3_600_000;
    const participantCount = Math.max(1, meeting._count.participants);
    const denominator = participantCount * durationHours;

    const numerator =
      decisions * MeetingRoiScorerWorker.WEIGHT_DECISIONS +
      commitments * MeetingRoiScorerWorker.WEIGHT_COMMITMENTS +
      tasks * MeetingRoiScorerWorker.WEIGHT_TASKS;

    const roiScoreFloat = denominator > 0 ? numerator / denominator : 0;
    const roiScore = new Prisma.Decimal(roiScoreFloat.toFixed(3));

    await this.prisma.meeting.update({
      where: { id: meetingId },
      data: {
        roiScore,
        roiScoreAt: new Date(),
      },
    });

    this.logger.debug(
      {
        meetingId,
        decisions,
        commitments,
        tasks,
        participantCount,
        durationMs,
        roiScore: roiScore.toString(),
        durationProcessingMs: Date.now() - startedAt,
      },
      'meeting-roi: рассчитан',
    );
  }

  private async countCommitments(meetingId: string, tenantId: string): Promise<number> {
    const rawEvents = await this.prisma.rawEvent.findMany({
      where: {
        tenantId,
        sourceType: 'meeting',
        sourceExternalId: meetingId,
      },
      select: { id: true },
    });
    if (rawEvents.length === 0) return 0;
    const rawEventIds = rawEvents.map((r) => r.id);

    const evidence = await this.prisma.ideaBlockEvidence.findMany({
      where: { rawEventId: { in: rawEventIds } },
      select: { blockId: true },
    });
    if (evidence.length === 0) return 0;
    const blockIds = [...new Set(evidence.map((e) => e.blockId))];

    return this.prisma.ideaBlock.count({
      where: {
        id: { in: blockIds },
        tenantId,
        signalType: 'commitment',
        status: 'canonical',
      },
    });
  }
}

function computeDurationMs(
  startedAt: Date | null,
  endedAt: Date | null,
  durationMs: number | null,
): number {
  if (typeof durationMs === 'number' && durationMs > 0) return durationMs;
  if (startedAt && endedAt) {
    return Math.max(0, endedAt.getTime() - startedAt.getTime());
  }
  return 0;
}
