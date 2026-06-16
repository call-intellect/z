import { Inject, Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../../../common/redis/redis.service';

@Injectable()
export class SocialContributionPreferenceService {
  private readonly logger = new Logger(SocialContributionPreferenceService.name);

  private static readonly REDIS_KEY_PREFIX = 'helpfulness:optout:';

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  private key(tenantId: string, userId: string): string {
    return `${SocialContributionPreferenceService.REDIS_KEY_PREFIX}${tenantId}:${userId}`;
  }

  async get(
    tenantId: string,
    userId: string,
  ): Promise<{ optedOut: boolean; updatedAt: string | null }> {
    const raw = await this.redis.client.get(this.key(tenantId, userId));
    if (!raw) {
      return { optedOut: false, updatedAt: null };
    }
    try {
      const parsed = JSON.parse(raw) as {
        optedOut: boolean;
        updatedAt: string;
      };
      return {
        optedOut: Boolean(parsed.optedOut),
        updatedAt: parsed.updatedAt ?? null,
      };
    } catch (e) {
      this.logger.warn(
        `Не удалось распарсить social-contribution opt-out для ${tenantId}/${userId}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return { optedOut: false, updatedAt: null };
    }
  }

  async set(
    tenantId: string,
    userId: string,
    optedOut: boolean,
  ): Promise<{ optedOut: boolean; updatedAt: string }> {
    const payload = { optedOut, updatedAt: new Date().toISOString() };
    await this.redis.client.set(this.key(tenantId, userId), JSON.stringify(payload));
    return payload;
  }
}
