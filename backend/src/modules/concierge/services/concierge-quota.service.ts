import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';

/**
 * SBA γ-2 — ConciergeQuotaService.
 *
 * Anti-abuse quota для Concierge Agent. Realtime-счётчик — Redis,
 * durable snapshot — БД (`OrgConciergeQuota`). Cron'ы daily/monthly
 * reset обнуляют счётчики и пишут snapshot.
 *
 * Redis-ключи:
 *   - `concierge:quota:daily:${tenantId}:${YYYY-MM-DD}`   → counter int
 *   - `concierge:quota:monthly:${tenantId}:${YYYY-MM}`    → counter int
 * TTL: daily — 36h, monthly — 33d (с запасом, cron подчистит).
 *
 * tryConsume() атомарно: INCR; если > limit — DECR обратно + false.
 */
@Injectable()
export class ConciergeQuotaService {
  private readonly logger = new Logger(ConciergeQuotaService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  /**
   * Попытаться списать 1 сообщение из daily+monthly квоты Org. Возвращает
   * `null` при успехе, или объект с причиной отказа.
   */
  async tryConsume(tenantId: string): Promise<{ scope: 'daily' | 'monthly' } | null> {
    const quota = await this.ensureQuota(tenantId);
    const dailyKey = this.dailyKey(tenantId);
    const monthlyKey = this.monthlyKey(tenantId);

    const client = this.redis.client;

    // Atomic INCR per day.
    const dailyAfter = await client.incr(dailyKey);
    if (dailyAfter === 1) {
      // expire через 36 часов (с запасом перед next-day reset)
      await client.expire(dailyKey, 36 * 3600);
    }
    if (dailyAfter > quota.dailyMessagesLimit) {
      await client.decr(dailyKey);
      this.metrics.incConciergeQuotaExceeded?.({
        tenantTop: this.tenantTop(tenantId),
        scope: 'daily',
      });
      return { scope: 'daily' };
    }

    const monthlyAfter = await client.incr(monthlyKey);
    if (monthlyAfter === 1) {
      await client.expire(monthlyKey, 33 * 24 * 3600);
    }
    if (monthlyAfter > quota.monthlyMessagesLimit) {
      await client.decr(monthlyKey);
      await client.decr(dailyKey); // откат daily, раз monthly failed
      this.metrics.incConciergeQuotaExceeded?.({
        tenantTop: this.tenantTop(tenantId),
        scope: 'monthly',
      });
      return { scope: 'monthly' };
    }
    return null;
  }

  /** Текущие счётчики для UI отображения. */
  async getUsage(tenantId: string): Promise<{
    dailyUsed: number;
    dailyLimit: number;
    monthlyUsed: number;
    monthlyLimit: number;
  }> {
    const quota = await this.ensureQuota(tenantId);
    const client = this.redis.client;
    const [d, m] = await Promise.all([
      client.get(this.dailyKey(tenantId)),
      client.get(this.monthlyKey(tenantId)),
    ]);
    return {
      dailyUsed: d ? Number(d) : 0,
      dailyLimit: quota.dailyMessagesLimit,
      monthlyUsed: m ? Number(m) : 0,
      monthlyLimit: quota.monthlyMessagesLimit,
    };
  }

  /**
   * Daily reset (cron). Сбрасывает realtime-счётчик в Redis,
   * сохраняет snapshot в БД.
   */
  async resetDaily(): Promise<{ tenantsReset: number }> {
    const quotas = await this.prisma.orgConciergeQuota.findMany();
    const client = this.redis.client;
    let n = 0;
    for (const q of quotas) {
      const key = this.dailyKey(q.tenantId);
      const cur = await client.get(key);
      const usedYesterday = cur ? Number(cur) : 0;
      await this.prisma.orgConciergeQuota.update({
        where: { tenantId: q.tenantId },
        data: { currentDailyCount: usedYesterday, resetDailyAt: new Date() },
      });
      await client.del(key);
      n++;
    }
    this.logger.log(`resetDaily: cleared daily counters for ${n} tenants`);
    return { tenantsReset: n };
  }

  /** Monthly reset (cron). */
  async resetMonthly(): Promise<{ tenantsReset: number }> {
    const quotas = await this.prisma.orgConciergeQuota.findMany();
    const client = this.redis.client;
    let n = 0;
    for (const q of quotas) {
      const key = this.monthlyKey(q.tenantId);
      const cur = await client.get(key);
      const usedLastMonth = cur ? Number(cur) : 0;
      await this.prisma.orgConciergeQuota.update({
        where: { tenantId: q.tenantId },
        data: {
          currentMonthlyCount: usedLastMonth,
          resetMonthlyAt: new Date(),
        },
      });
      await client.del(key);
      n++;
    }
    this.logger.log(`resetMonthly: cleared monthly counters for ${n} tenants`);
    return { tenantsReset: n };
  }

  // ──────────────────────────── private ────────────────────────────────

  private async ensureQuota(tenantId: string) {
    let q = await this.prisma.orgConciergeQuota.findUnique({
      where: { tenantId },
    });
    if (!q) {
      q = await this.prisma.orgConciergeQuota.create({
        data: {
          tenantId,
          dailyMessagesLimit: this.cfg.concierge.dailyMessagesLimit,
          monthlyMessagesLimit: this.cfg.concierge.monthlyMessagesLimit,
        },
      });
    }
    return q;
  }

  private dailyKey(tenantId: string): string {
    const d = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return `concierge:quota:daily:${tenantId}:${d}`;
  }

  private monthlyKey(tenantId: string): string {
    const d = new Date().toISOString().slice(0, 7); // YYYY-MM
    return `concierge:quota:monthly:${tenantId}:${d}`;
  }

  /**
   * Cardinality-safe label bucket для метрик. Hash mod 100 → 'bucket_NN'.
   * Защищает от взрыва series при тысячах Org.
   */
  private tenantTop(tenantId: string): string {
    let h = 0;
    for (let i = 0; i < tenantId.length; i++) {
      h = (h * 31 + tenantId.charCodeAt(i)) >>> 0;
    }
    return `bucket_${(h % 100).toString().padStart(2, '0')}`;
  }
}
