import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { RedisService } from '../../../common/redis/redis.service';
import { tenantTopOf } from '../utils/tenant-top';

export interface AnswerCacheKeyArgs {
  tenantId: string;
  userId: string;
  standaloneQuestion: string;
  scope: string;
  scopeRefId: string | null;
  validAt: string | null;
}

export interface AnswerCacheEntry {
  text: string;
  citations: unknown[];
  uncertaintyNote: string | null;
  mode: string;
  usedBlockIds: string[];
  cachedAt: string;
  dataClass?: string;
}

const KEY_PREFIX = 'dlg:ans';

@Injectable()
export class AnswerCacheService {
  private readonly logger = new Logger(AnswerCacheService.name);

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  buildKey(args: AnswerCacheKeyArgs): string {
    const payload = [
      args.standaloneQuestion.trim().toLowerCase(),
      args.scope,
      args.scopeRefId ?? '-',
      args.validAt ?? '-',
    ].join('|');
    const hash = createHash('sha256').update(payload).digest('hex').slice(0, 32);
    return `${KEY_PREFIX}:${args.tenantId}:${args.userId}:${hash}`;
  }

  async get(args: AnswerCacheKeyArgs): Promise<AnswerCacheEntry | null> {
    const key = this.buildKey(args);
    try {
      const raw = await this.redis.client.get(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as AnswerCacheEntry;
      this.metrics.incAnswerCacheHit({ tenantTop: tenantTopOf(args.tenantId) });
      return parsed;
    } catch (err) {
      this.logger.warn(
        { key, err: err instanceof Error ? err.message : String(err) },
        'AnswerCache.get: redis error — treat as miss',
      );
      return null;
    }
  }

  async set(args: AnswerCacheKeyArgs, entry: AnswerCacheEntry): Promise<void> {
    const key = this.buildKey(args);
    const ttl = this.cfg.dialogLayer.answerCacheTtlSeconds;
    try {
      await this.redis.client.set(key, JSON.stringify(entry), 'EX', ttl);
    } catch (err) {
      this.logger.warn(
        { key, err: err instanceof Error ? err.message : String(err) },
        'AnswerCache.set: redis error — игнор',
      );
    }
  }

  async invalidateTenant(tenantId: string): Promise<number> {
    const pattern = `${KEY_PREFIX}:${tenantId}:*`;
    return this.scanAndDelete(pattern);
  }

  async invalidateUser(tenantId: string, userId: string): Promise<number> {
    const pattern = `${KEY_PREFIX}:${tenantId}:${userId}:*`;
    return this.scanAndDelete(pattern);
  }

  private async scanAndDelete(pattern: string): Promise<number> {
    let cursor = '0';
    let deleted = 0;
    try {
      do {
        const [next, keys] = await this.redis.client.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
        cursor = next;
        if (keys.length > 0) {
          deleted += await this.redis.client.del(...keys);
        }
      } while (cursor !== '0');
    } catch (err) {
      this.logger.warn(
        { pattern, err: err instanceof Error ? err.message : String(err) },
        'AnswerCache.scanAndDelete: redis error',
      );
    }
    return deleted;
  }
}
