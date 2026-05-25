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

describe('workspace getter — sync resolve через AdminSetting + ENV', () => {
  it('cacheMap override: hydrateSync задаёт значение → workspace отдаёт его без обращения к ENV', () => {
    const envGet = vi.fn();
    const raw = { get: envGet } as unknown as ConfigService;
    const cfg = new TypedConfigService(raw, null);

    cfg.hydrateSync([['limits.maxChatRequestsPerDay', 999]]);

    expect(cfg.workspace.maxChatRequestsPerDay).toBe(999);
    // На MAX_CHAT_REQUESTS_PER_DAY обращений быть не должно — cache hit.
    const envCalls = envGet.mock.calls.map(([key]) => key);
    expect(envCalls).not.toContain('MAX_CHAT_REQUESTS_PER_DAY');
  });

  it('ENV fallback: cacheMap пустой → workspace читает значение из ENV', () => {
    const cfg = buildService({ MAX_CHAT_REQUESTS_PER_DAY: 200 });
    expect(cfg.workspace.maxChatRequestsPerDay).toBe(200);
  });

  it('cacheMap override для maxApiKeysPerUser — типизация остаётся number, значение из cache', () => {
    const cfg = buildService();
    cfg.hydrateSync([['limits.maxApiKeysPerUser', 25]]);
    const value: number = cfg.workspace.maxApiKeysPerUser;
    expect(value).toBe(25);
  });
});

describe('retention / argon / auth-TTL — sync resolve', () => {
  it('retention cacheMap override: hydrateSync задаёт значения → retention отдаёт их', () => {
    const cfg = buildService();
    cfg.hydrateSync([
      ['retention.chatEnabled', false],
      ['retention.defaultDays', 365],
    ]);
    expect(cfg.retention.chatEnabled).toBe(false);
    expect(cfg.retention.defaultDays).toBe(365);
  });

  it('retention ENV fallback: cacheMap пустой → значения из ENV', () => {
    const cfg = buildService({
      DEFAULT_RETENTION_DAYS: 30,
      RETENTION_CRON: '0 * * * *',
    });
    expect(cfg.retention.defaultDays).toBe(30);
    expect(cfg.retention.cron).toBe('0 * * * *');
  });

  it('argon cacheMap override: applySync задаёт memoryKb → argon отдаёт новое значение', () => {
    const cfg = buildService();
    cfg.applySync('security.argonMemoryKb', 65536);
    expect(cfg.argon.memoryKb).toBe(65536);
  });

  it('auth TTL не трогает прочие поля: sessionSecret по-прежнему читается через ENV (this.get)', () => {
    // cacheMap пустой — никаких security.sessionTtlSeconds в нём нет.
    const cfg = buildService({
      JWT_SESSION_SECRET: 'env-session-secret',
      JWT_DEEP_LINK_SECRET: 'env-deep-link-secret',
      COOKIE_DOMAIN: 'example.com',
      PUBLIC_FRONTEND_URL: 'https://app.example.com',
      SESSION_TTL_SECONDS: 3_600,
      DEEP_LINK_TTL_SECONDS: 600,
    });
    expect(cfg.auth.sessionSecret).toBe('env-session-secret');
    expect(cfg.auth.deepLinkSecret).toBe('env-deep-link-secret');
    expect(cfg.auth.publicFrontendUrl).toBe('https://app.example.com');
    // TTL'ы тоже работают через resolveSync → ENV-fallback.
    expect(cfg.auth.sessionTtlSeconds).toBe(3_600);
    expect(cfg.auth.deepLinkTtlSeconds).toBe(600);
  });
});
