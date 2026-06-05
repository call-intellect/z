import { Inject, Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../../../common/redis/redis.service';

/**
 * ТЗ-E Ф4 (2026-06-05) — настройка opt-out социального вклада (Helpfulness).
 *
 * MVP-хранение: Redis (по аналогии с `RecognitionPreferenceService`).
 *   Ключ: `helpfulness:optout:<tenantId>:<userId>` → JSON `{ optedOut, updatedAt }`.
 *
 * Поведение по умолчанию: `optedOut=false` (если ключа нет — пользователь
 * виден публично). `updatedAt=null`, пока настройка ни разу не сохранялась.
 *
 * TODO(ТЗ-E): когда появится модель `PersonHelpfulnessPreference` в Prisma —
 *   мигрировать (запись в БД + Redis-cache). Сейчас Redis достаточно: настройка
 *   меняется редко, читается быстро.
 *
 * TODO(ТЗ-E): фактическая фильтрация публичной ленты «Спасибо команде» и
 *   счётчиков по `optedOut=true` — вне scope этой фазы (требует доступа к
 *   preference из cron/spotlight-pipeline). Сейчас сохраняется только намерение
 *   пользователя; применение opt-out к ленте — отдельная задача.
 */
@Injectable()
export class SocialContributionPreferenceService {
  private readonly logger = new Logger(
    SocialContributionPreferenceService.name,
  );

  /** TTL = 0 (no expire) — настройка переживает рестарт Redis. */
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
      // Дефолт — виден публично, настройка ни разу не менялась.
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
    await this.redis.client.set(
      this.key(tenantId, userId),
      JSON.stringify(payload),
    );
    return payload;
  }
}
