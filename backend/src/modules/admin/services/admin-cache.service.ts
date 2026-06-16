import { Injectable, Logger } from '@nestjs/common';

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
