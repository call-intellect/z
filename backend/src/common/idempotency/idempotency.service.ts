import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../config/index';
import { RedisService } from '../redis/redis.service';

export interface IdempotencyCachedResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async getCached(key: string, tenantId: string | null): Promise<IdempotencyCachedResponse | null> {
    const redisKey = this.buildKey(key, tenantId);
    try {
      const raw = await this.redis.client.get(redisKey);
      if (!raw) return null;
      return JSON.parse(raw) as IdempotencyCachedResponse;
    } catch (err) {
      this.logger.warn(
        `Redis GET ${redisKey} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  async setCached(
    key: string,
    tenantId: string | null,
    response: IdempotencyCachedResponse,
    ttlSeconds?: number,
  ): Promise<void> {
    const redisKey = this.buildKey(key, tenantId);
    const ttl = ttlSeconds ?? this.cfg.tracker.idempotencyKeyTtlSeconds;
    try {
      await this.redis.client.set(
        redisKey,
        JSON.stringify(response),
        'EX',
        Math.max(1, Math.floor(ttl)),
      );
    } catch (err) {
      this.logger.warn(
        `Redis SET ${redisKey} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  buildKey(key: string, tenantId: string | null): string {
    const tenantPart = tenantId && tenantId.length > 0 ? tenantId : 'global';
    return `idempotency:${tenantPart}:${key}`;
  }
}
