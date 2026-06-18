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
  BITRIX_SYNC_JOB_OPTIONS,
  BITRIX_SYNC_QUEUE,
  type BitrixSyncJobData,
  type BitrixSyncScope,
} from './bitrix-sync.queue';

@Injectable()
export class BitrixSyncQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BitrixSyncQueueService.name);
  private queue: Queue<BitrixSyncJobData> | null = null;

  private static readonly SCOPES: readonly BitrixSyncScope[] = ['all', 'users', 'dialogs', 'crm'];
  private static readonly RUNNING_STATES = new Set<string>([
    'active',
    'waiting',
    'delayed',
    'prioritized',
    'waiting-children',
  ]);

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.queue = new Queue<BitrixSyncJobData>(BITRIX_SYNC_QUEUE, {
      connection: this.redis.client,
      defaultJobOptions: BITRIX_SYNC_JOB_OPTIONS,
    });
    this.logger.log(`BitrixSyncQueue: очередь ${BITRIX_SYNC_QUEUE} готова`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close().catch(() => undefined);
      this.queue = null;
    }
  }

  async enqueue(
    tenantId: string,
    scope: BitrixSyncScope,
    since?: string,
  ): Promise<{ jobId: string }> {
    const queue = this.requireQueue();
    const jobId = since
      ? `bitrix-sync-${tenantId}-${scope}-backfill`
      : `bitrix-sync-${tenantId}-${scope}`;
    await queue.remove(jobId).catch(() => undefined);
    await queue.add('sync', { tenantId, scope, since }, { jobId });
    this.logger.log(
      `enqueue: tenant=${tenantId} scope=${scope} since=${since ?? '-'} jobId=${jobId}`,
    );
    return { jobId };
  }

  async getRunningScopes(tenantId: string): Promise<BitrixSyncScope[]> {
    const queue = this.requireQueue();
    const probes: { scope: BitrixSyncScope; jobId: string }[] =
      BitrixSyncQueueService.SCOPES.map((scope) => ({
        scope,
        jobId: `bitrix-sync-${tenantId}-${scope}`,
      }));
    probes.push({ scope: 'dialogs', jobId: `bitrix-sync-${tenantId}-dialogs-backfill` });
    const states = await Promise.all(
      probes.map(async ({ scope, jobId }) => ({
        scope,
        state: await queue.getJobState(jobId).catch(() => 'unknown'),
      })),
    );
    const running = new Set<BitrixSyncScope>();
    for (const s of states) {
      if (BitrixSyncQueueService.RUNNING_STATES.has(s.state)) running.add(s.scope);
    }
    return [...running];
  }

  private requireQueue(): Queue<BitrixSyncJobData> {
    if (!this.queue) {
      throw new Error('BitrixSyncQueue: queue не инициализирован');
    }
    return this.queue;
  }
}
