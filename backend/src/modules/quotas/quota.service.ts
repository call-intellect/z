import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { AuditLogService } from '../audit/audit-log.service';
import { AUDIT } from '../audit/audit.types';

import { QuotaExceededError } from './quota.errors';

/**
 * Per-user квоты на дорогие операции (chat, exports, регенерация и т.д.).
 *
 * Алгоритм (см. ТЗ §«Per-user квоты»):
 *   1. Ключ: `quota:{userId}:{quotaName}:{floor(now/windowMs)*windowMs}`.
 *   2. INCR в Redis, EXPIRE на windowMs+60.
 *   3. Если значение после INCR > max:
 *      - DECR обратно (чтобы счётчик не «съел» одну единицу),
 *      - инкремент метрики `quota_exceeded_total{quota_name}`,
 *      - запись `AuditLog(action='quota.exceeded')`,
 *      - throw `QuotaExceededError(retryAfterSeconds)`.
 *   4. Иначе — каждые 10 инкрементов snapshot в `UserQuotaCounter`
 *      (для админ-дашборда; не каждый INCR — экономим writes).
 *
 * Примечания:
 *   - Используем стандартный INCR (atomic в Redis). Race condition между
 *     INCR и проверкой невозможна.
 *   - Snapshot-флаш — fire-and-forget; ошибка БД не валит запрос.
 */
@Injectable()
export class QuotaService {
  private readonly logger = new Logger(QuotaService.name);

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  /**
   * Атомарный INCR в Redis. На превышении — throw QuotaExceededError.
   * На успехе — возвращает текущее значение и оставшийся лимит.
   */
  async checkAndIncrement(input: {
    userId: string;
    quotaName: string;
    max: number;
    windowMs: number;
    /** Сколько единиц инкрементить за раз (default 1). Полезно для quote по токенам. */
    amount?: number;
  }): Promise<{ ok: true; current: number; remaining: number }> {
    const amount = input.amount ?? 1;
    const now = Date.now();
    const windowStart = Math.floor(now / input.windowMs) * input.windowMs;
    const key = `quota:${input.userId}:${input.quotaName}:${windowStart}`;
    const ttlSec = Math.ceil(input.windowMs / 1000) + 60;

    const client = this.redis.client;
    // Pipeline: INCRBY + EXPIRE одним RTT.
    const pipeline = client.multi();
    pipeline.incrby(key, amount);
    pipeline.expire(key, ttlSec);
    const replies = await pipeline.exec();
    if (!replies || replies.length === 0) {
      // Если pipeline завалился — фоллбэк: разрешаем (fail-open для UX),
      // но логируем.
      this.logger.warn(`QuotaService: pipeline.exec() пустой для ${key}, fail-open`);
      return { ok: true, current: amount, remaining: input.max - amount };
    }
    const incrReply = replies[0];
    const current = Number(incrReply?.[1] ?? 0);

    if (current > input.max) {
      // Откатываем инкремент.
      await client.decrby(key, amount).catch(() => undefined);
      // Метрика.
      this.metrics?.incQuotaExceeded({ quotaName: input.quotaName });
      // Audit.
      await this.audit.log({
        userId: input.userId,
        action: AUDIT.QUOTA_EXCEEDED,
        metadata: { quotaName: input.quotaName, max: input.max, requested: amount },
      });
      // Retry-after = время до конца окна.
      const retryAfterSeconds = Math.ceil((windowStart + input.windowMs - now) / 1000);
      throw new QuotaExceededError(input.quotaName, retryAfterSeconds, input.max);
    }

    // Snapshot в БД (каждые 10 инкрементов или если current кратен 10).
    if (current % 10 === 0) {
      void this.snapshot({
        userId: input.userId,
        quotaName: input.quotaName,
        windowStart: new Date(windowStart),
        count: current,
      }).catch((err) => {
        this.logger.debug(
          `QuotaService.snapshot: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }

    return { ok: true, current, remaining: Math.max(0, input.max - current) };
  }

  /**
   * Текущее значение счётчика (без инкремента). Используется для
   * показа лимита юзеру.
   */
  async peek(input: {
    userId: string;
    quotaName: string;
    windowMs: number;
  }): Promise<number> {
    const windowStart = Math.floor(Date.now() / input.windowMs) * input.windowMs;
    const key = `quota:${input.userId}:${input.quotaName}:${windowStart}`;
    const value = await this.redis.client.get(key);
    return value ? Number(value) : 0;
  }

  private async snapshot(input: {
    userId: string;
    quotaName: string;
    windowStart: Date;
    count: number;
  }): Promise<void> {
    await this.prisma.userQuotaCounter.upsert({
      where: {
        userId_quotaName_windowStart: {
          userId: input.userId,
          quotaName: input.quotaName,
          windowStart: input.windowStart,
        },
      },
      create: {
        userId: input.userId,
        quotaName: input.quotaName,
        windowStart: input.windowStart,
        count: input.count,
      },
      update: { count: input.count },
    });
  }
}
