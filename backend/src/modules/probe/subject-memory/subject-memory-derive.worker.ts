import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import { RedisService } from '../../../common/redis/redis.service';
import {
  CORE_QUEUE_NAMES,
  type SubjectMemoryDeriveJobData,
} from '../../core-queue/queues';

import { SubjectMemoryService } from './subject-memory.service';

@Injectable()
export class SubjectMemoryDeriveWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SubjectMemoryDeriveWorker.name);
  private worker: Worker<SubjectMemoryDeriveJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(SubjectMemoryService)
    private readonly subjectMemory: SubjectMemoryService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<SubjectMemoryDeriveJobData>(
      CORE_QUEUE_NAMES.SUBJECT_MEMORY_DERIVE,
      async (job) => this.process(job),
      {
        connection: this.redis.client,
        concurrency: 2,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        {
          probeEventId: job?.data?.probeEventId,
          attempt: job?.attemptsMade,
          err: err?.message,
        },
        'subject-memory-derive: job failed (повтор по политике BullMQ)',
      );
    });
    this.logger.log(
      `SubjectMemoryDeriveWorker запущен (${CORE_QUEUE_NAMES.SUBJECT_MEMORY_DERIVE})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async process(job: Job<SubjectMemoryDeriveJobData>): Promise<void> {
    const { tenantId, probeEventId, questionText, answerText, occurredAtIso } =
      job.data;
    try {
      await this.subjectMemory.deriveRuleFromProbeResponse({
        tenantId,
        probeId: probeEventId,
        questionText,
        answerText,
        occurredAt: new Date(occurredAtIso),
      });
    } catch (err) {
      this.logger.warn(
        {
          probeEventId,
          err: err instanceof Error ? err.message : String(err),
        },
        'subject-memory-derive: process упал — пропускаю',
      );
    }
  }
}
