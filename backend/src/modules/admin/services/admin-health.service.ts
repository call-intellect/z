import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  HeadBucketCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { Queue } from 'bullmq';
import { RoomServiceClient } from 'livekit-server-sdk';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { QUEUE_NAMES } from '../../ai/queues';
import { CORE_QUEUE_NAMES } from '../../core-queue/queues';
import { TRACKER_QUEUE_NAMES } from '../../tracker/queues';

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

export interface HealthQueuesResult {
  queues: QueueCountsRow[];
  generatedAt: string;
}

export interface HealthDbResult {
  sizeBytes: number | null;
  connections: {
    total: number | null;
    active: number | null;
    idle: number | null;
  };
  ideaBlocksTotal: number;
  entitiesTotal: number;
  rawEventsTotal: number;
  aiUsageLogTotal: number;
  generatedAt: string;
}

export interface HealthEmbeddingsResult {
  /** Кол-во IdeaBlock с непустым embedding. */
  total: number;
  /** Прирост за 24ч (новые IdeaBlock с embedding != null). */
  last24hGrowth: number;
  generatedAt: string;
}

export interface HealthWorkersResult {
  crons: Array<{
    name: string;
    expression: string;
    enabled: boolean;
    lastRunAt: Date | null;
    lastRunDurationMs: number | null;
    lastRunError: string | null;
  }>;
  recentRuns: Array<{
    id: string;
    cronName: string;
    startedAt: Date;
    durationMs: number | null;
    status: string;
    error: string | null;
    triggeredBy: string | null;
  }>;
  generatedAt: string;
}

export interface HealthS3Result {
  ok: boolean;
  endpointUrl: string;
  bucket: string;
  error?: string;
  generatedAt: string;
}

export interface HealthLivekitResult {
  ok: boolean;
  apiUrl: string;
  error?: string;
  generatedAt: string;
}

/**
 * `AdminHealthService` (Admin-redesign Фаза 1, расширение).
 *
 * Источник состояния всех подсистем для UI Z-Admin «Пульс / Здоровье»:
 *   - `getHealth()`         — overall сводка (legacy, оставлен для обратной совместимости).
 *   - `getQueues()`         — counts по всем BullMQ-очередям.
 *   - `getDb()`             — pg_database_size + pg_stat_activity (connections).
 *   - `getEmbeddings()`     — кол-во IdeaBlock с embedding + 24h прирост.
 *   - `getWorkers()`        — состояние Cron'ов (из CronSchedule) + последние CronRunHistory.
 *   - `getS3()`             — `HeadBucket` (try-catch).
 *   - `getLivekit()`        — `RoomServiceClient.listRooms` (try-catch).
 *
 * Все методы — best-effort: при ошибке возвращают `{ ok: false, error }`,
 * а не бросают. Это нужно для дашборда, где «красная плашка» лучше 500.
 */
@Injectable()
export class AdminHealthService implements OnModuleDestroy {
  private readonly logger = new Logger(AdminHealthService.name);
  private queueCache = new Map<string, Queue>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
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

  // ────────────────────────── overall (legacy) ──────────────────────────

  async getHealth(): Promise<AdminHealthResult> {
    const queueResults = await this.collectQueueCounts();

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

  // ─────────────────────────── per-subsystem api ────────────────────────

  async getQueues(): Promise<HealthQueuesResult> {
    const queues = await this.collectQueueCounts();
    return { queues, generatedAt: new Date().toISOString() };
  }

  async getDb(): Promise<HealthDbResult> {
    const [dbSize, connections, blocks, entities, rawEvents, aiUsage] =
      await Promise.all([
        this.fetchDbSize(),
        this.fetchConnections(),
        this.prisma.ideaBlock.count(),
        this.prisma.entity.count(),
        this.prisma.rawEvent.count(),
        this.prisma.aiUsageLog.count(),
      ]);
    return {
      sizeBytes: dbSize,
      connections,
      ideaBlocksTotal: blocks,
      entitiesTotal: entities,
      rawEventsTotal: rawEvents,
      aiUsageLogTotal: aiUsage,
      generatedAt: new Date().toISOString(),
    };
  }

  async getEmbeddings(): Promise<HealthEmbeddingsResult> {
    let total = 0;
    let last24hGrowth = 0;
    try {
      const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM "IdeaBlock"
        WHERE embedding IS NOT NULL
      `;
      total = Number(rows[0]?.count ?? 0n);
    } catch (err) {
      this.logger.warn(
        `Health.embeddings: total query failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      // Прирост = IdeaBlock с embedding, созданные за 24h. Если у IdeaBlock
      // есть createdAt — используем; иначе суррогат через updatedAt.
      const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM "IdeaBlock"
        WHERE embedding IS NOT NULL
          AND COALESCE("createdAt", "updatedAt") > NOW() - INTERVAL '24 hours'
      `;
      last24hGrowth = Number(rows[0]?.count ?? 0n);
    } catch (err) {
      this.logger.warn(
        `Health.embeddings: growth query failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return {
      total,
      last24hGrowth,
      generatedAt: new Date().toISOString(),
    };
  }

  async getWorkers(): Promise<HealthWorkersResult> {
    const [crons, recentRuns] = await Promise.all([
      this.prisma.cronSchedule.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.cronRunHistory.findMany({
        orderBy: { startedAt: 'desc' },
        take: 50,
      }),
    ]);
    return {
      crons: crons.map((c) => ({
        name: c.name,
        expression: c.expression,
        enabled: c.enabled,
        lastRunAt: c.lastRunAt,
        lastRunDurationMs: c.lastRunDurationMs,
        lastRunError: c.lastRunError,
      })),
      recentRuns: recentRuns.map((r) => ({
        id: r.id,
        cronName: r.cronName,
        startedAt: r.startedAt,
        durationMs: r.durationMs,
        status: r.status,
        error: r.error,
        triggeredBy: r.triggeredBy,
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  async getS3(): Promise<HealthS3Result> {
    const s3Cfg = this.cfg.s3;
    const config: S3ClientConfig = {
      region: s3Cfg.region,
      endpoint: s3Cfg.endpointUrl,
      credentials: {
        accessKeyId: s3Cfg.accessKey,
        secretAccessKey: s3Cfg.secretKey,
      },
      forcePathStyle: true,
    };
    const client = new S3Client(config);
    try {
      await client.send(new HeadBucketCommand({ Bucket: s3Cfg.bucket }));
      return {
        ok: true,
        endpointUrl: s3Cfg.endpointUrl,
        bucket: s3Cfg.bucket,
        generatedAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        ok: false,
        endpointUrl: s3Cfg.endpointUrl,
        bucket: s3Cfg.bucket,
        error: err instanceof Error ? err.message : String(err),
        generatedAt: new Date().toISOString(),
      };
    } finally {
      client.destroy();
    }
  }

  async getLivekit(): Promise<HealthLivekitResult> {
    const lk = this.cfg.livekit;
    try {
      const client = new RoomServiceClient(lk.apiUrl, lk.apiKey, lk.apiSecret);
      // listRooms() — лёгкий запрос для проверки доступности SFU.
      await client.listRooms();
      return {
        ok: true,
        apiUrl: lk.apiUrl,
        generatedAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        ok: false,
        apiUrl: lk.apiUrl,
        error: err instanceof Error ? err.message : String(err),
        generatedAt: new Date().toISOString(),
      };
    }
  }

  // ─────────────────────────── private ──────────────────────────────────

  private async collectQueueCounts(): Promise<QueueCountsRow[]> {
    const queueNames = [
      ...Object.values(QUEUE_NAMES),
      ...Object.values(CORE_QUEUE_NAMES),
      ...Object.values(TRACKER_QUEUE_NAMES),
    ];
    const connection = this.redis.client;
    return Promise.all(
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
  }

  private getOrCreateQueue(
    name: string,
    connection:
      | ReturnType<RedisService['client']['duplicate']>
      | RedisService['client'],
  ): Queue {
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

  private async fetchConnections(): Promise<{
    total: number | null;
    active: number | null;
    idle: number | null;
  }> {
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{ state: string | null; count: bigint }>
      >`
        SELECT state, COUNT(*)::bigint AS count
        FROM pg_stat_activity
        WHERE datname = current_database()
        GROUP BY state
      `;
      let total = 0;
      let active = 0;
      let idle = 0;
      for (const r of rows) {
        const n = Number(r.count);
        total += n;
        if (r.state === 'active') active += n;
        else if (r.state === 'idle') idle += n;
      }
      return { total, active, idle };
    } catch (err) {
      this.logger.warn(
        `pg_stat_activity failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { total: null, active: null, idle: null };
    }
  }
}
