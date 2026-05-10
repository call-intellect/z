import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { QUEUE_NAMES } from '../../ai/queues';
import { CORE_QUEUE_NAMES } from '../../core-queue/queues';

interface QueueCountsRow {
  queueName: string;
  counts: Record<string, number>;
}

export interface AdminHealthResult {
  queues: QueueCountsRow[];
  database: {
    sizeBytes: number | null;
    ideaBlocksTotal: number;
    entitiesTotal: number;
    rawEventsTotal: number;
    aiUsageLogTotal: number;
  };
  redis: {
    available: boolean;
    error?: string;
  };
  s3: {
    available: 'unknown';
  };
  generatedAt: string;
}

/**
 * AdminHealthService (Z-Admin Фаза 7 шаг 6).
 *
 *   - getHealth(): состояние очередей (Bull.getJobCounts),
 *     размер БД (pg_database_size), счётчики ключевых таблиц,
 *     ping Redis, S3 пропускаем (Фаза 11).
 *
 * Очереди создаются на каждый вызов (без shared queue list — пока легче,
 * чем тащить shared instances через CoreQueueService/AiQueueService). Если в
 * production нагрузка вырастет — кэшировать на 30s через AdminCacheService.
 */
@Injectable()
export class AdminHealthService implements OnModuleDestroy {
  private readonly logger = new Logger(AdminHealthService.name);
  private queueCache = new Map<string, Queue>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  async onModuleDestroy(): Promise<void> {
    for (const q of this.queueCache.values()) {
      try {
        await q.close();
      } catch (err) {
        this.logger.warn(
          `Ошибка при закрытии queue ${q.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    this.queueCache.clear();
  }

  async getHealth(): Promise<AdminHealthResult> {
    const queueNames = [
      ...Object.values(QUEUE_NAMES),
      ...Object.values(CORE_QUEUE_NAMES),
    ];
    const connection = this.redis.client;

    const queueResults = await Promise.all(
      queueNames.map(async (name) => {
        const q = this.getOrCreateQueue(name, connection);
        try {
          const counts = await q.getJobCounts(
            'waiting',
            'active',
            'completed',
            'failed',
            'delayed',
            'paused',
          );
          return { queueName: name, counts: counts as Record<string, number> };
        } catch (err) {
          this.logger.warn(
            `getJobCounts(${name}) failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          return { queueName: name, counts: {} };
        }
      }),
    );

    const [dbSize, blocks, entities, rawEvents, aiUsage] = await Promise.all([
      this.fetchDbSize(),
      this.prisma.ideaBlock.count(),
      this.prisma.entity.count(),
      this.prisma.rawEvent.count(),
      this.prisma.aiUsageLog.count(),
    ]);

    let redisAvailable = false;
    let redisError: string | undefined;
    try {
      await this.redis.ping();
      redisAvailable = true;
    } catch (err) {
      redisError = err instanceof Error ? err.message : String(err);
    }

    return {
      queues: queueResults,
      database: {
        sizeBytes: dbSize,
        ideaBlocksTotal: blocks,
        entitiesTotal: entities,
        rawEventsTotal: rawEvents,
        aiUsageLogTotal: aiUsage,
      },
      redis: redisAvailable
        ? { available: true }
        : { available: false, error: redisError ?? 'unknown' },
      s3: { available: 'unknown' as const },
      generatedAt: new Date().toISOString(),
    };
  }

  private getOrCreateQueue(name: string, connection: ReturnType<RedisService['client']['duplicate']> | RedisService['client']): Queue {
    const cached = this.queueCache.get(name);
    if (cached) return cached;
    const q = new Queue(name, { connection: connection as never });
    this.queueCache.set(name, q);
    return q;
  }

  private async fetchDbSize(): Promise<number | null> {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ size: bigint }>>`
        SELECT pg_database_size(current_database())::bigint AS size
      `;
      const first = rows[0];
      if (!first) return null;
      return Number(first.size);
    } catch (err) {
      this.logger.warn(
        `pg_database_size failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
