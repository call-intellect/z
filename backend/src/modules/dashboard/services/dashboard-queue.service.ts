import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type JobsOptions, Queue } from 'bullmq';

import { RedisService } from '../../../common/redis/redis.service';
import {
  DASHBOARD_QUEUE_NAMES,
  type DashboardQueueName,
  DECISION_HYGIENE_JOB_OPTIONS,
  type DecisionHygieneJobData,
  MEETING_ROI_JOB_OPTIONS,
  type MeetingRoiJobData,
} from '../queues';

@Injectable()
export class DashboardQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DashboardQueueService.name);
  private queues: Map<DashboardQueueName, Queue<unknown>> | null = null;

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  onModuleInit(): void {
    const connection = this.redis.client;
    const map = new Map<DashboardQueueName, Queue<unknown>>();
    for (const name of Object.values(DASHBOARD_QUEUE_NAMES)) {
      const opts: JobsOptions =
        name === DASHBOARD_QUEUE_NAMES.MEETING_ROI
          ? MEETING_ROI_JOB_OPTIONS
          : DECISION_HYGIENE_JOB_OPTIONS;
      map.set(
        name,
        new Queue<unknown>(name, {
          connection,
          defaultJobOptions: opts,
        }),
      );
    }
    this.queues = map;
    this.logger.log(`DashboardQueueService инициализирован (${map.size} очередей)`);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.queues) return;
    for (const q of this.queues.values()) {
      try {
        await q.close();
      } catch (err) {
        this.logger.warn(
          `Ошибка при закрытии очереди ${q.name}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    this.queues = null;
  }

  async enqueueMeetingRoi(meetingId: string): Promise<void> {
    const q = this.requireQueue(DASHBOARD_QUEUE_NAMES.MEETING_ROI);
    const payload: MeetingRoiJobData = { meetingId };
    const jobId = `meeting-roi_${meetingId}`;
    await q.add('meeting-roi', payload, { jobId });
    this.logger.debug(`enqueue dashboard.meeting-roi meeting=${meetingId}`);
  }

  async enqueueDecisionHygiene(args: { decisionId: string; tenantId: string }): Promise<void> {
    const q = this.requireQueue(DASHBOARD_QUEUE_NAMES.DECISION_HYGIENE);
    const payload: DecisionHygieneJobData = {
      decisionId: args.decisionId,
      tenantId: args.tenantId,
    };
    const jobId = `decision-hygiene_${args.decisionId}`;
    await q.add('decision-hygiene', payload, { jobId });
    this.logger.debug(`enqueue dashboard.decision-hygiene decision=${args.decisionId}`);
  }

  private requireQueue(name: DashboardQueueName): Queue<unknown> {
    const map = this.queues;
    if (!map) {
      throw new Error('DashboardQueueService: попытка enqueue до onModuleInit');
    }
    const q = map.get(name);
    if (!q) {
      throw new Error(`DashboardQueueService: очередь ${name} не инициализирована`);
    }
    return q;
  }
}
