import { Inject, Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../../../common/redis/redis.service';
import type { RecognitionOptOutResponseDto } from '../dto/recognition.dto';

@Injectable()
export class RecognitionPreferenceService {
  private readonly logger = new Logger(RecognitionPreferenceService.name);

  private static readonly REDIS_KEY_PREFIX = 'recognition:pref:';

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  private key(tenantId: string, userId: string): string {
    return `${RecognitionPreferenceService.REDIS_KEY_PREFIX}${tenantId}:${userId}`;
  }

  async get(tenantId: string, userId: string): Promise<RecognitionOptOutResponseDto> {
    const raw = await this.redis.client.get(this.key(tenantId, userId));
    if (!raw) {
      return { publicVisible: true, updatedAt: new Date(0).toISOString() };
    }
    try {
      const parsed = JSON.parse(raw) as { publicVisible: boolean; updatedAt: string };
      return {
        publicVisible: Boolean(parsed.publicVisible),
        updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
      };
    } catch (e) {
      this.logger.warn(
        `Не удалось распарсить recognition-preference для ${tenantId}/${userId}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return { publicVisible: true, updatedAt: new Date(0).toISOString() };
    }
  }

  async set(
    tenantId: string,
    userId: string,
    publicVisible: boolean,
  ): Promise<RecognitionOptOutResponseDto> {
    const payload = { publicVisible, updatedAt: new Date().toISOString() };
    await this.redis.client.set(this.key(tenantId, userId), JSON.stringify(payload));
    return payload;
  }
}
