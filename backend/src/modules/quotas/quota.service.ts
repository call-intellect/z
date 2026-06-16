import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { AuditLogService } from '../audit/audit-log.service';
import { AUDIT } from '../audit/audit.types';

import { QuotaExceededError } from './quota.errors';

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

  async checkAndIncrement(input: {
    userId: string;
    quotaName: string;
    max: number;
    windowMs: number;
    amount?: number;
  }): Promise<{ ok: true; current: number; remaining: number }> {
    const amount = input.amount ?? 1;
    const now = Date.now();
    const windowStart = Math.floor(now / input.windowMs) * input.windowMs;
    const key = `quota:${input.userId}:${input.quotaName}:${windowStart}`;
    const ttlSec = Math.ceil(input.windowMs / 1000) + 60;

    const client = this.redis.client;
    const pipeline = client.multi();
    pipeline.incrby(key, amount);
    pipeline.expire(key, ttlSec);
    const replies = await pipeline.exec();
    if (!replies || replies.length === 0) {
      this.logger.warn(`QuotaService: pipeline.exec() пустой для ${key}, fail-open`);
      return { ok: true, current: amount, remaining: input.max - amount };
    }
    const incrReply = replies[0];
    const current = Number(incrReply?.[1] ?? 0);

    if (current > input.max) {
      await client.decrby(key, amount).catch(() => undefined);
      this.metrics?.incQuotaExceeded({ quotaName: input.quotaName });
      await this.audit.log({
        userId: input.userId,
        action: AUDIT.QUOTA_EXCEEDED,
        metadata: { quotaName: input.quotaName, max: input.max, requested: amount },
      });
      const retryAfterSeconds = Math.ceil((windowStart + input.windowMs - now) / 1000);
      throw new QuotaExceededError(input.quotaName, retryAfterSeconds, input.max);
    }

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

  async peek(input: { userId: string; quotaName: string; windowMs: number }): Promise<number> {
    const windowStart = Math.floor(Date.now() / input.windowMs) * input.windowMs;
    const key = `quota:${input.userId}:${input.quotaName}:${windowStart}`;
    const value = await this.redis.client.get(key);
    return value ? Number(value) : 0;
  }

  async checkAndIncrementOrg(input: {
    tenantId: string;
    quotaName: string;
    max: number;
    windowMs: number;
    amount?: number;
  }): Promise<{ ok: true; current: number; remaining: number }> {
    const amount = input.amount ?? 1;
    const now = Date.now();
    const windowStart = Math.floor(now / input.windowMs) * input.windowMs;
    const key = `quota:org:${input.tenantId}:${input.quotaName}:${windowStart}`;
    const ttlSec = Math.ceil(input.windowMs / 1000) + 60;

    const client = this.redis.client;
    const pipeline = client.multi();
    pipeline.incrby(key, amount);
    pipeline.expire(key, ttlSec);
    const replies = await pipeline.exec();
    if (!replies || replies.length === 0) {
      this.logger.warn(
        `QuotaService.checkAndIncrementOrg: pipeline.exec() пустой для ${key}, fail-open`,
      );
      return { ok: true, current: amount, remaining: input.max - amount };
    }
    const incrReply = replies[0];
    const current = Number(incrReply?.[1] ?? 0);

    if (current > input.max) {
      await client.decrby(key, amount).catch(() => undefined);
      this.metrics?.incQuotaExceeded({ quotaName: input.quotaName });
      await this.audit.log({
        action: AUDIT.QUOTA_EXCEEDED,
        metadata: {
          tenantId: input.tenantId,
          quotaName: input.quotaName,
          max: input.max,
          requested: amount,
          scope: 'org',
        },
      });
      const retryAfterSeconds = Math.ceil((windowStart + input.windowMs - now) / 1000);
      throw new QuotaExceededError(input.quotaName, retryAfterSeconds, input.max);
    }

    return { ok: true, current, remaining: Math.max(0, input.max - current) };
  }

  async peekOrg(input: { tenantId: string; quotaName: string; windowMs: number }): Promise<number> {
    const windowStart = Math.floor(Date.now() / input.windowMs) * input.windowMs;
    const key = `quota:org:${input.tenantId}:${input.quotaName}:${windowStart}`;
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
