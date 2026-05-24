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
  ISSUE_EMBED_JOB_OPTIONS,
  type IssueEmbedJobData,
  TRACKER_QUEUE_NAMES,
} from '../queues';

/**
 * Tracker Phase 3 (Sprint 6, 2026-05-24) — продьюсер очереди
 * `core.issue-embed`. Lightweight: только создание Queue + enqueue.
 * Воркер (`IssueEmbedWorker`) живёт в отдельном процессе `workers/main.ts`.
 *
 * Идемпотентность: `jobId = issue-embed:{issueId}:{embeddingHash || 'init'}`.
 * BullMQ при совпадении `jobId` уже стоящего job'а игнорирует повторный
 * `add()`. Это защищает от шторма enqueue при batch-обновлении задач.
 *
 * Поведение caller'а:
 *   - `enqueue()` НЕ блокирует основной flow и ловит ошибки сам (логируем
 *     warn). Embedding — best-effort: если БД доступна, а Redis нет —
 *     задача создаётся / обновляется штатно, embedding появится позже
 *     при следующем апдейте.
 */
@Injectable()
export class IssueEmbedQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IssueEmbedQueueService.name);
  private queue: Queue<IssueEmbedJobData> | null = null;

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.queue = new Queue<IssueEmbedJobData>(TRACKER_QUEUE_NAMES.ISSUE_EMBED, {
      connection: this.redis.client,
      defaultJobOptions: ISSUE_EMBED_JOB_OPTIONS,
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
  }

  /**
   * Поставить задачу на пересчёт embedding'а.
   *
   * @param args.tenantId — owner для cross-tenant защиты в воркере.
   * @param args.issueId — ID задачи.
   * @param args.embeddingHash — текущий hash (если есть, для idempotent jobId).
   */
  async enqueue(args: {
    tenantId: string;
    issueId: string;
    embeddingHash?: string | null;
  }): Promise<void> {
    if (!this.queue) {
      this.logger.warn('IssueEmbedQueueService: queue не инициализирована');
      return;
    }
    const jobId = `issue-embed:${args.issueId}:${args.embeddingHash ?? 'init'}`;
    await this.queue.add(
      'issue-embed',
      { tenantId: args.tenantId, issueId: args.issueId },
      { jobId },
    );
  }
}
