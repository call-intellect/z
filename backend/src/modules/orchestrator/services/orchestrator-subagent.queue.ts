import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type JobsOptions, Queue } from 'bullmq';

import { RedisService } from '../../../common/redis/redis.service';

export const ORCHESTRATOR_SUBAGENTS_QUEUE = 'orchestrator.subagents';

export interface OrchestratorSubagentJobData {
  subagentJobId: string;
  runId: string;
  tenantId: string;
  userId: string;
  timeoutMsPerStep: number;
}

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 2,
  backoff: { type: 'exponential', delay: 3000 },
  removeOnComplete: { age: 3600, count: 200 },
  removeOnFail: { age: 86400, count: 200 },
};

@Injectable()
export class OrchestratorSubagentQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrchestratorSubagentQueue.name);
  private queue: Queue<OrchestratorSubagentJobData> | null = null;

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.queue = new Queue<OrchestratorSubagentJobData>(ORCHESTRATOR_SUBAGENTS_QUEUE, {
      connection: this.redis.client,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    this.logger.log(`OrchestratorSubagentQueue инициализирована (${ORCHESTRATOR_SUBAGENTS_QUEUE})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      try {
        await this.queue.close();
      } catch (err) {
        this.logger.warn(
          `Ошибка при закрытии очереди: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      this.queue = null;
    }
  }

  async enqueue(data: OrchestratorSubagentJobData): Promise<void> {
    if (!this.queue) {
      throw new Error('OrchestratorSubagentQueue не инициализирована');
    }
    await this.queue.add('orchestrator-subagent', data, {
      jobId: `subagent_${data.subagentJobId}`,
    });
    this.logger.debug(
      `enqueue ${ORCHESTRATOR_SUBAGENTS_QUEUE} subagentJobId=${data.subagentJobId} runId=${data.runId}`,
    );
  }
}
