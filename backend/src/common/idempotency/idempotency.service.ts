import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../config/index';
import { RedisService } from '../redis/redis.service';

/**
 * Снимок HTTP-ответа, который мы кэшируем в Redis под Idempotency-Key.
 * `status` — финальный HTTP-статус, `body` — JSON-сериализуемое тело,
 * `headers` — опциональный whitelist response-headers (например, `Location`).
 */
export interface IdempotencyCachedResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

/**
 * Универсальный store для Idempotency-Key (RFC draft "The Idempotency-Key
 * HTTP Header Field").
 *
 * В отличие от Crossmark-специфичного `IdempotencyInterceptor`
 * (`common/interceptors/idempotency.interceptor.ts`, пишет в Postgres-таблицу
 * `crossmark_idempotency`), этот сервис работает только с Redis и применяется
 * в общих trakcer-эндпоинтах: POST /api/v1/issues, POST /api/v1/issues/:id/
 * comments, POST /api/v1/intake.
 *
 * Контракт:
 *   - ключ Redis  →  `idempotency:${tenantId ?? 'global'}:${key}`
 *   - значение    →  JSON {status, body, headers?}
 *   - TTL         →  по умолчанию `cfg.tracker.idempotencyKeyTtlSeconds`
 *                    (ENV `IDEMPOTENCY_KEY_TTL_SECONDS`, default 86400).
 *
 * Гонки: для атомарной первой записи используется `SET ... NX EX <ttl>`,
 * но в middleware мы пишем уже после успешного выполнения handler'а, поэтому
 * race-condition между двумя одновременными запросами с одним ключом
 * разруливается на уровне SQL (уникальные ограничения в БД) — здесь же мы
 * просто перезаписываем последний ответ, что безопасно (тело идентично, если
 * операция действительно идемпотентна).
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  /**
   * Достаёт ранее сохранённый ответ по `Idempotency-Key`.
   * При проблемах Redis возвращает `null` (fail-open — каллер выполнит
   * хендлер заново, никаких 5xx из-за этого не отдаём).
   */
  async getCached(
    key: string,
    tenantId: string | null,
  ): Promise<IdempotencyCachedResponse | null> {
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

  /**
   * Сохраняет снимок ответа на TTL секунд.
   * Перезаписывает существующий — это намеренно (см. примечание про гонки).
   */
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
      // fail-open: не блокируем основной HTTP-ответ. Лог + забыли.
      this.logger.warn(
        `Redis SET ${redisKey} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Формирует ключ Redis: `idempotency:${tenantId ?? 'global'}:${key}`. */
  buildKey(key: string, tenantId: string | null): string {
    const tenantPart = tenantId && tenantId.length > 0 ? tenantId : 'global';
    return `idempotency:${tenantPart}:${key}`;
  }
}
