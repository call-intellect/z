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
  TABLE_ENRICH_JOB_OPTIONS,
  TABLES_QUEUE_NAMES,
  type TableEnrichJobData,
} from '../queues';

/**
 * Диспетчер очереди `tables.enrich` (Smart-tables Фаза 3 — Event-to-Cells).
 *
 * Воркер (`TableEnrichWorker`) живёт in-process в `WorkersModule`; здесь —
 * только enqueue. Регистрируется в `TablesModule` (доступен listener'у).
 */
@Injectable()
export class TableEnrichQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TableEnrichQueueService.name);
  private queue: Queue<TableEnrichJobData> | null = null;

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.queue = new Queue<TableEnrichJobData>(TABLES_QUEUE_NAMES.ENRICH, {
      connection: this.redis.client,
      defaultJobOptions: TABLE_ENRICH_JOB_OPTIONS,
    });
    this.logger.log(
      `TableEnrichQueueService инициализирован (${TABLES_QUEUE_NAMES.ENRICH})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      try {
        await this.queue.close();
      } catch (err) {
        this.logger.warn(
          `Ошибка при закрытии очереди ${TABLES_QUEUE_NAMES.ENRICH}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      this.queue = null;
    }
  }

  /**
   * Поставить enrich по встрече. jobId `table:enrich:<meetingId>` —
   * идемпотентно: повторный enqueue той же встречи в течение жизни job'а в
   * Redis игнорируется.
   */
  async enqueueMeetingEnrich(data: TableEnrichJobData): Promise<void> {
    const q = this.queue;
    if (!q) {
      throw new Error('TableEnrichQueueService: enqueue до onModuleInit');
    }
    const jobId = `table:enrich:${data.meetingId}`;
    await q.add('meeting-enrich', data, { jobId });
    this.logger.debug(`enqueue tables.enrich meeting=${data.meetingId}`);
  }
}
