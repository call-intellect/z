import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { RedisService } from '../../../common/redis/redis.service';

@Injectable()
export class ProactiveDedupService {
  private readonly logger = new Logger(ProactiveDedupService.name);

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  buildKey(args: { tenantId: string; userId: string; dateLocal: string }): string {
    return `proactive:dedup:${args.tenantId}:${args.userId}:${args.dateLocal}`;
  }

  async acquire(args: { tenantId: string; userId: string; dateLocal: string }): Promise<boolean> {
    const ttlSeconds = Math.max(60, Math.floor(this.cfg.proactive.antiSpamTtlHours * 3600));
    const key = this.buildKey(args);
    try {
      const result = await this.redis.client.set(
        key,
        new Date().toISOString(),
        'EX',
        ttlSeconds,
        'NX',
      );
      return result === 'OK';
    } catch (err) {
      this.logger.warn(
        {
          key,
          err: err instanceof Error ? err.message : String(err),
        },
        'proactive-dedup.acquire: Redis SETNX failed — пропускаем notification (fail-closed)',
      );
      return false;
    }
  }

  async forceRelease(args: { tenantId: string; userId: string; dateLocal: string }): Promise<void> {
    try {
      await this.redis.client.del(this.buildKey(args));
    } catch {}
  }
}
