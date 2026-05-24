import { Inject, Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../../../common/redis/redis.service';
import type { RecognitionOptOutResponseDto } from '../dto/recognition.dto';

/**
 * T1 (2026-05-23) — настройка `publicVisible` для Recognition.
 *
 * MVP-хранение: Redis (HSET по тенанту).
 *   Ключ:  `recognition:pref:<tenantId>:<userId>` → JSON `{ publicVisible, updatedAt }`.
 *
 * TODO(t1): когда появится модель `PersonRecognitionPreference` в Prisma —
 *   мигрировать (запись в БД + Redis-cache). Сейчас Redis достаточно: настройка
 *   меняется редко, TeamSpotlight cron'у нужно быстро прочитать список opt-out.
 *
 * Поведение по умолчанию: `publicVisible=true` (если ключа нет в Redis).
 */
@Injectable()
export class RecognitionPreferenceService {
  private readonly logger = new Logger(RecognitionPreferenceService.name);

  /** TTL = 0 (no expire) — настройка переживает рестарт Redis (на dev — потеря OK). */
  private static readonly REDIS_KEY_PREFIX = 'recognition:pref:';

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  private key(tenantId: string, userId: string): string {
    return `${RecognitionPreferenceService.REDIS_KEY_PREFIX}${tenantId}:${userId}`;
  }

  async get(
    tenantId: string,
    userId: string,
  ): Promise<RecognitionOptOutResponseDto> {
    const raw = await this.redis.client.get(this.key(tenantId, userId));
    if (!raw) {
      // Дефолт — видим всем.
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
