import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Queue } from 'bullmq';

import { RedisService } from '../../../common/redis/redis.service';
import {
  INTAKE_AUTO_TRIAGE_JOB_OPTIONS,
  type IntakeAutoTriageJobData,
  TRACKER_QUEUE_NAMES,
} from '../queues';

@Injectable()
export class IntakeAutoTriageQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IntakeAutoTriageQueueService.name);
  private queue: Queue<IntakeAutoTriageJobData> | null = null;

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.queue = new Queue<IntakeAutoTriageJobData>(TRACKER_QUEUE_NAMES.INTAKE_AUTO_TRIAGE, {
      connection: this.redis.client,
      defaultJobOptions: INTAKE_AUTO_TRIAGE_JOB_OPTIONS,
    });
    this.logger.log(
      `IntakeAutoTriageQueueService инициализирован (${TRACKER_QUEUE_NAMES.INTAKE_AUTO_TRIAGE})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      try {
        await this.queue.close();
      } catch (err) {
        this.logger.warn(
          `Ошибка при закрытии очереди ${TRACKER_QUEUE_NAMES.INTAKE_AUTO_TRIAGE}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      this.queue = null;
    }
  }

  async enqueue(args: { tenantId: string; intakeIssueId: string }): Promise<void> {
    if (!this.queue) {
      throw new Error('IntakeAutoTriageQueueService: попытка enqueue до onModuleInit');
    }
    const jobId = `intake-auto-triage_${args.intakeIssueId}`;
    await this.queue.add(
      'intake-auto-triage',
      { tenantId: args.tenantId, intakeIssueId: args.intakeIssueId },
      { jobId },
    );
    this.logger.debug(
      `enqueue ${TRACKER_QUEUE_NAMES.INTAKE_AUTO_TRIAGE} intake=${args.intakeIssueId}`,
    );
  }
}
