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
  CHATBOX_SYNC_JOB_OPTIONS,
  CHATBOX_SYNC_QUEUE,
  type ChatboxSyncJobData,
  type ChatboxSyncScope,
} from './chatbox-sync.queue';

@Injectable()
export class ChatboxSyncQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatboxSyncQueueService.name);
  private queue: Queue<ChatboxSyncJobData> | null = null;

  private static readonly SCOPES: readonly ChatboxSyncScope[] = [
    'all',
    'customers',
    'managers',
    'chats',
    'incremental',
  ];
  private static readonly RUNNING_STATES = new Set<string>([
    'active',
    'waiting',
    'delayed',
    'prioritized',
    'waiting-children',
  ]);

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.queue = new Queue<ChatboxSyncJobData>(CHATBOX_SYNC_QUEUE, {
      connection: this.redis.client,
      defaultJobOptions: CHATBOX_SYNC_JOB_OPTIONS,
    });
    this.logger.log(`ChatboxSyncQueue: очередь ${CHATBOX_SYNC_QUEUE} готова`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close().catch(() => undefined);
      this.queue = null;
    }
  }

  async enqueue(
    tenantId: string,
    scope: ChatboxSyncScope,
    since?: string,
  ): Promise<{ jobId: string }> {
    const queue = this.requireQueue();
    const jobId = since
      ? `chatbox-sync-${tenantId}-${scope}-backfill`
      : `chatbox-sync-${tenantId}-${scope}`;
    await queue.remove(jobId).catch(() => undefined);
    await queue.add('sync', { tenantId, scope, since }, { jobId });
    this.logger.log(
      `enqueue: tenant=${tenantId} scope=${scope} since=${since ?? '-'} jobId=${jobId}`,
    );
    return { jobId };
  }

  async getRunningScopes(tenantId: string): Promise<ChatboxSyncScope[]> {
    const queue = this.requireQueue();
    const probes: { scope: ChatboxSyncScope; jobId: string }[] = ChatboxSyncQueueService.SCOPES.map(
      (scope) => ({ scope, jobId: `chatbox-sync-${tenantId}-${scope}` }),
    );
    probes.push({ scope: 'chats', jobId: `chatbox-sync-${tenantId}-chats-backfill` });
    const states = await Promise.all(
      probes.map(async ({ scope, jobId }) => ({
        scope,
        running: ChatboxSyncQueueService.RUNNING_STATES.has(
          await queue.getJobState(jobId).catch(() => 'unknown'),
        ),
      })),
    );
    const running = new Set<ChatboxSyncScope>();
    for (const s of states) {
      if (s.running) running.add(s.scope);
    }
    return [...running];
  }

  private requireQueue(): Queue<ChatboxSyncJobData> {
    if (!this.queue) {
      throw new Error('ChatboxSyncQueue: queue не инициализирован');
    }
    return this.queue;
  }
}
