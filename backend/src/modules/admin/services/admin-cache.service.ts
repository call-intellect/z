import { Injectable, Logger } from '@nestjs/common';

/**
 * AdminCacheService (Z-Admin + Org-Admin, Фаза 7 шаг 8).
 *
 * In-memory TTL-кэш. Используется в `AdminUsageService.getDashboard` (TTL 60s)
 * и в других admin-сервисах, где результат не должен пересчитываться на каждый
 * пуш F5 в UI.
 *
 * Принципиально: кэш — single-process. Если backend размножается на >1 ноду,
 * кэш у каждой свой (в production текущая Z-инфра — один backend-pod, см.
 * `second-brain/02_architecture/runtime-topology.md`). Распределённый кэш
 * (Redis / pg-cache) — vNext.
 *
 * API:
 *   - `get<T>(key)` → значение или null.
 *   - `setWithTtl(key, value, ttlMs)` → положить с истечением.
 *   - `invalidate(prefix)` → удалить все ключи, начинающиеся с `prefix`.
 *
 * NB: prefix-инвалидация делает linear scan по Map'у. Для текущих масштабов
 * (десятки ключей) это норма; на 1000+ ключей перейти на trie или раздельные
 * Map'ы по namespace.
 */
@Injectable()
export class AdminCacheService {
  private readonly logger = new Logger(AdminCacheService.name);
  private readonly store = new Map<string, { value: unknown; expiresAt: number }>();

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  setWithTtl<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  invalidate(prefix: string): void {
    let removed = 0;
    for (const k of this.store.keys()) {
      if (k.startsWith(prefix)) {
        this.store.delete(k);
        removed++;
      }
    }
    if (removed > 0) {
      this.logger.debug(`AdminCacheService.invalidate('${prefix}'): ${removed} keys`);
    }
  }

  clear(): void {
    this.store.clear();
  }
}
