import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { RedisService } from '../../../common/redis/redis.service';

/**
 * SBA δ-2 — Anti-spam dedup-сервис для ProactiveWatcher.
 *
 * Гарантирует «максимум 1 proactive notification per user per day»:
 * перед отправкой ставим Redis SETNX key
 * `proactive:dedup:{tenantId}:{userId}:{dateLocal}` с TTL N часов
 * (PROACTIVE_WATCHER_ANTI_SPAM_TTL_HOURS, default 24).
 *
 * Возврат `true` — lock захвачен, можно отправлять (запись ProactiveNotification
 * создаётся ТОЛЬКО после успешного захвата).
 * Возврат `false` — уже была отправка за эти сутки, skip.
 *
 * NB: для тестов есть `forceRelease(...)` — удаляет ключ. В проде не вызываем.
 */
@Injectable()
export class ProactiveDedupService {
  private readonly logger = new Logger(ProactiveDedupService.name);

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  buildKey(args: {
    tenantId: string;
    userId: string;
    dateLocal: string;
  }): string {
    return `proactive:dedup:${args.tenantId}:${args.userId}:${args.dateLocal}`;
  }

  /**
   * Захватить lock на доставку proactive-уведомления конкретному user в день.
   * @returns true — lock наш (можно отправлять), false — уже занят (skip).
   */
  async acquire(args: {
    tenantId: string;
    userId: string;
    dateLocal: string;
  }): Promise<boolean> {
    const ttlSeconds = Math.max(
      60,
      Math.floor(this.cfg.proactive.antiSpamTtlHours * 3600),
    );
    const key = this.buildKey(args);
    try {
      // NX = только если ключа нет; EX = TTL в секундах.
      // ioredis: set(key, value, 'EX', seconds, 'NX')
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
      // Fail-closed: при ошибке Redis считаем, что lock не наш (НЕ отправляем).
      // Это безопаснее, чем дублировать сообщение.
      return false;
    }
  }

  /** Для тестов: принудительно удалить ключ. */
  async forceRelease(args: {
    tenantId: string;
    userId: string;
    dateLocal: string;
  }): Promise<void> {
    try {
      await this.redis.client.del(this.buildKey(args));
    } catch {
      /* swallow */
    }
  }
}
