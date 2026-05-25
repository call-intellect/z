/**
 * Unit-тесты для sync-cache механизма TypedConfigService (Фаза 1
 * env-to-admin-setting-call-sites-migration).
 *
 * Покрываем:
 *   1) hydrateSync + resolveSync — чтение из cacheMap.
 *   2) resolveSync — fallback на ENV.
 *   3) resolveSync — fallback на defaultValue.
 *   4) resolveSync — throws, если все три источника пусты.
 *   5) applySync(key, undefined) — удаление, далее ENV.
 *   6) applySync(key, value) — добавление/перезапись.
 *   7) hydrateSync идемпотентен — повторный вызов заменяет содержимое.
 */

import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import { TypedConfigService } from './typed-config.service';

function buildService(envMap: Record<string, unknown> = {}): TypedConfigService {
  const raw = {
    get: vi.fn((key: string) => envMap[key]),
  } as unknown as ConfigService;
  // ModuleRef не нужен для sync-cache тестов.
  return new TypedConfigService(raw, null);
}

describe('TypedConfigService — sync admin-setting cache', () => {
  it('hydrateSync заливает ключи; resolveSync возвращает из cache', () => {
    const cfg = buildService();
    cfg.hydrateSync([
      ['limits.maxX', 99],
      ['limits.maxY', 'abc'],
    ]);
    expect(cfg.resolveSync<number>('limits.maxX', 'MAX_X', 1)).toBe(99);
    expect(cfg.resolveSync<string>('limits.maxY', undefined, 'def')).toBe('abc');
  });

  it('resolveSync падает на ENV, если в cache нет, но в ENV есть', () => {
    const cfg = buildService({ MAX_X: 42 });
    expect(cfg.resolveSync<number>('limits.maxX', 'MAX_X', 1)).toBe(42);
  });

  it('resolveSync возвращает defaultValue, если cache и ENV пусты', () => {
    const cfg = buildService();
    expect(cfg.resolveSync<number>('limits.maxX', 'MAX_X', 7)).toBe(7);
  });

  it('resolveSync throws, если все три источника пусты', () => {
    const cfg = buildService();
    expect(() => cfg.resolveSync<number>('limits.maxX', 'MAX_X')).toThrow(
      /не найден ни в cache, ни в ENV/,
    );
  });

  it('applySync(key, undefined) удаляет ключ; resolveSync после этого падает на ENV', () => {
    const cfg = buildService({ MAX_X: 5 });
    cfg.hydrateSync([['limits.maxX', 999]]);
    expect(cfg.resolveSync<number>('limits.maxX', 'MAX_X', 1)).toBe(999);
    cfg.applySync('limits.maxX', undefined);
    expect(cfg.resolveSync<number>('limits.maxX', 'MAX_X', 1)).toBe(5);
  });

  it('applySync(key, newValue) добавляет/перезаписывает ключ; resolveSync возвращает новое значение', () => {
    const cfg = buildService({ MAX_X: 5 });
    // Добавление.
    cfg.applySync('limits.maxX', 100);
    expect(cfg.resolveSync<number>('limits.maxX', 'MAX_X', 1)).toBe(100);
    // Перезапись.
    cfg.applySync('limits.maxX', 200);
    expect(cfg.resolveSync<number>('limits.maxX', 'MAX_X', 1)).toBe(200);
  });

  it('hydrateSync идемпотентен — повторный вызов с другим набором заменяет содержимое', () => {
    const cfg = buildService({ MAX_Y: 'env-y' });
    cfg.hydrateSync([
      ['limits.maxX', 1],
      ['limits.maxY', 'first'],
    ]);
    expect(cfg.resolveSync<number>('limits.maxX', 'MAX_X', 0)).toBe(1);

    // Повторный hydrate с другим набором — старый ключ должен исчезнуть.
    cfg.hydrateSync([['limits.maxY', 'second']]);
    expect(cfg.resolveSync<string>('limits.maxY', 'MAX_Y', 'd')).toBe('second');
    // limits.maxX больше нет в cache — должен упасть на ENV/default.
    expect(cfg.resolveSync<number>('limits.maxX', 'MAX_X', 77)).toBe(77);
  });
});
