import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type JobsOptions, Queue } from 'bullmq';

import { RedisService } from '../../common/redis/redis.service';

import {
  CORE_DEFAULT_JOB_OPTIONS,
  CORE_QUEUE_NAMES,
  type CoreQueueName,
  type RawEventJobData,
} from './queues';

/**
 * HTTP-side диспетчер knowledge-core очередей. По аналогии с `AiQueueService`.
 *
 * Воркеры (`block-ingest.worker`, Фаза 2) живут в отдельном процессе.
 * На Фазе 1 ни один консумер не подписан на `core.raw-events` — jobs
 * накапливаются в Redis. BullMQ хранит их без потерь.
 *
 * jobId формируется из `rawEventId` — даёт идемпотентность: повторный
 * enqueue для того же `RawEvent` (например, при retry ingest pipeline)
 * не создаст дубль job'а в очереди.
 */
@Injectable()
export class CoreQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CoreQueueService.name);
  private queues: Map<CoreQueueName, Queue<unknown>> | null = null;

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  onModuleInit(): void {
    const connection = this.redis.client;
    const map = new Map<CoreQueueName, Queue<unknown>>();
    for (const name of Object.values(CORE_QUEUE_NAMES)) {
      const opts: JobsOptions = CORE_DEFAULT_JOB_OPTIONS;
      map.set(
        name,
        new Queue<unknown>(name, {
          connection,
          defaultJobOptions: opts,
        }),
      );
    }
    this.queues = map;
    this.logger.log(`CoreQueueService инициализирован (${map.size} очередей)`);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.queues) return;
    for (const q of this.queues.values()) {
      try {
        await q.close();
      } catch (err) {
        this.logger.warn(
          `Ошибка при закрытии очереди ${q.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    this.queues = null;
  }

  // ─────────────────────────── enqueue API ─────────────────────────────────

  /**
   * Публикация события `raw.received`. Consumer — `block-ingest.worker` (Фаза 2).
   * jobId = `raw_<rawEventId>` для идемпотентности.
   *
   * NB: BullMQ 5.x запрещает `:` в Custom Id (см. Job.validateOptions),
   * поэтому используем `_` как разделитель (cuid сам по себе `:` не содержит).
   */
  async enqueueRawReceived(rawEventId: string): Promise<void> {
    const map = this.queues;
    if (!map) {
      throw new Error('CoreQueueService: попытка enqueue до onModuleInit');
    }
    const q = map.get(CORE_QUEUE_NAMES.RAW_EVENTS);
    if (!q) {
      throw new Error('CoreQueueService: core.raw-events не инициализирован');
    }
    const jobId = `raw_${rawEventId}`;
    const payload: RawEventJobData = { rawEventId };
    await q.add('raw-received', payload, { jobId });
    this.logger.debug(`enqueue core.raw-events rawEventId=${rawEventId}`);
  }
}
