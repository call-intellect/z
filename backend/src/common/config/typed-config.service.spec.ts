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

  it('resolveSync throws, только если envFallbackKey не передан и default отсутствует', () => {
    const cfg = buildService();
    // Без envFallbackKey и без default → throws.
    expect(() => cfg.resolveSync<number>('limits.maxX')).toThrow(
      /не найден ни в cache, ни в ENV/,
    );
  });

  it('resolveSync возвращает undefined, если envFallbackKey передан, но ни ENV-значения, ни default нет (Фаза 4 — optional ENV)', () => {
    const cfg = buildService(); // ENV пуст
    const value = cfg.resolveSync<string | undefined>(
      'embeddings.fallbackLocalUrl',
      'EMBEDDING_FALLBACK_LOCAL_URL',
    );
    expect(value).toBeUndefined();
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

describe('embeddings + aiFeatures — sync resolve (Фаза 4)', () => {
  it('embeddings cacheMap override: hydrateSync задаёт dimensions → cfg.ai.embeddings.dimensions отдаёт его', () => {
    const cfg = buildService({
      // ENV-fallback для остальных полей геттера, чтобы они не упали на throws.
      EMBEDDING_PROVIDER: 'openai-via-proxy',
      EMBEDDING_MODEL: 'text-embedding-3-small',
      OPENAI_PROXY_API_KEY: 'k',
      OPENAI_PROXY_EMBEDDINGS_URL: 'https://proxy/v1/embeddings',
      EMBEDDING_BATCH_SIZE: 100,
      EMBEDDING_CHUNK_TARGET_TOKENS: 400,
      EMBEDDING_CHUNK_OVERLAP_TOKENS: 50,
    });
    cfg.hydrateSync([['embeddings.dimensions', 768]]);
    expect(cfg.ai.embeddings.dimensions).toBe(768);
  });

  it('aiFeatures cacheMap override: hydrateSync задаёт includeRoomChat=false → cfg.aiFeatures.includeRoomChat=false', () => {
    const cfg = buildService();
    cfg.hydrateSync([['aiFeatures.includeRoomChat', false]]);
    expect(cfg.aiFeatures.includeRoomChat).toBe(false);
  });

  it('embeddings.fallbackLocalUrl: optional ENV — cacheMap пустой, ENV undefined → undefined без throws', () => {
    // ENV не задаёт EMBEDDING_FALLBACK_LOCAL_URL (он optional в schema).
    // Остальные обязательные ENV даём, чтобы остальной геттер не упал.
    const cfg = buildService({
      EMBEDDING_PROVIDER: 'openai-via-proxy',
      EMBEDDING_MODEL: 'text-embedding-3-small',
      EMBEDDING_DIMENSIONS: 1536,
      OPENAI_PROXY_API_KEY: 'k',
      OPENAI_PROXY_EMBEDDINGS_URL: 'https://proxy/v1/embeddings',
      EMBEDDING_BATCH_SIZE: 100,
      EMBEDDING_CHUNK_TARGET_TOKENS: 400,
      EMBEDDING_CHUNK_OVERLAP_TOKENS: 50,
    });
    expect(cfg.ai.embeddings.fallbackLocalUrl).toBeUndefined();
  });

  it('aiFeatures ENV fallback: cacheMap пустой → значения из ENV', () => {
    const cfg = buildService({
      INCLUDE_ROOM_CHAT_IN_AI: true,
      TRANSCRIPT_CLEANING_LLM_REFINE_ENABLED: false,
      BEHAVIOR_METRICS_LLM_REFINE_ENABLED: true,
      PROMPT_INJECTION_GUARD_ENABLED: false,
    });
    expect(cfg.aiFeatures.includeRoomChat).toBe(true);
    expect(cfg.aiFeatures.transcriptCleaningLlmRefine).toBe(false);
    expect(cfg.aiFeatures.behaviorMetricsLlmRefine).toBe(true);
    expect(cfg.aiFeatures.promptInjectionGuardEnabled).toBe(false);
  });
});

describe('Фаза 5 — crossmark/webhook/share/emailFetch/idle/quotas', () => {
  it('idle.timeoutMinutes cacheMap override: hydrateSync → cfg.idle.timeoutMinutes отдаёт значение из cache', () => {
    const cfg = buildService();
    cfg.hydrateSync([['idle.timeoutMinutes', 60]]);
    expect(cfg.idle.timeoutMinutes).toBe(60);
  });

  it('share.allowedExpirationDays массив через cacheMap: hydrateSync задаёт [3, 30] → cfg.share.allowedExpirationDays === [3, 30]', () => {
    const cfg = buildService();
    cfg.hydrateSync([['share.allowedExpirationDays', [3, 30]]]);
    expect(cfg.share.allowedExpirationDays).toEqual([3, 30]);
  });

  it('webhook.egressAllowedHosts CSV-парсинг: cacheMap содержит строку — геттер парсит её в массив', () => {
    const cfg = buildService();
    cfg.hydrateSync([['webhook.egressAllowedHosts', 'a.com, b.com,  c.com']]);
    expect(cfg.webhooksOut.egressAllowedHosts).toEqual(['a.com', 'b.com', 'c.com']);
  });

  it('crossmark.hmacTimestampWindowSeconds ENV fallback: cacheMap пустой → значение из ENV', () => {
    const cfg = buildService({ CROSSMARK_HMAC_TIMESTAMP_WINDOW_SECONDS: 600 });
    expect(cfg.crossmark.hmacTimestampWindowSeconds).toBe(600);
  });

  it('emailFetch ENV fallback: cacheMap пустой → значения из ENV', () => {
    const cfg = buildService({
      EMAIL_FETCH_ENABLED: true,
      EMAIL_FETCH_CRON: '*/10 * * * *',
      EMAIL_FETCH_MAX_PER_RUN: 200,
    });
    expect(cfg.emailFetch.enabled).toBe(true);
    expect(cfg.emailFetch.cron).toBe('*/10 * * * *');
    expect(cfg.emailFetch.maxPerRun).toBe(200);
  });

  it('quotas через limits.* cacheMap: hydrateSync задаёт maxParticipantsPerMeeting → геттер отдаёт его', () => {
    const cfg = buildService();
    cfg.hydrateSync([
      ['limits.maxParticipantsPerMeeting', 25],
      ['limits.maxMeetingDurationHours', 12],
    ]);
    expect(cfg.quotas.maxParticipantsPerMeeting).toBe(25);
    expect(cfg.quotas.maxMeetingDurationHours).toBe(12);
  });
});

describe('Фаза 6 — пороги графа knowledge-core живые (resolveSync, не this.get)', () => {
  it('linkerMinBlocks — крутилка ЖИВАЯ: applySync override побеждает ENV-дефолт', () => {
    // ENV задаёт «старое большое» значение; крутилка должна его перебить.
    const cfg = buildService({ LINKER_MIN_BLOCKS: 50 });
    expect(cfg.knowledgeCore.linkerMinBlocks).toBe(50); // ENV fallback
    cfg.applySync('knowledge.linkerMinBlocks', 3);
    // Если бы геттер читал через this.get('LINKER_MIN_BLOCKS'), вернулось бы 50.
    expect(cfg.knowledgeCore.linkerMinBlocks).toBe(3);
  });

  it('linkerMinBlocks — code-default 3, когда нет ни cache, ни ENV', () => {
    const cfg = buildService();
    expect(cfg.knowledgeCore.linkerMinBlocks).toBe(3);
  });

  it('linkMinConfidence — крутилка ЖИВАЯ: hydrateSync override побеждает ENV-дефолт', () => {
    const cfg = buildService({ LINK_MIN_CONFIDENCE: 0.75 });
    expect(cfg.knowledgeCore.linkMinConfidence).toBe(0.75); // ENV fallback
    cfg.hydrateSync([['knowledge.linkMinConfidence', 0.5]]);
    expect(cfg.knowledgeCore.linkMinConfidence).toBe(0.5);
  });

  it('tracker.autoAcceptConfidenceThreshold — code-default 0.75 + ЖИВАЯ крутилка (hydrateSync побеждает)', () => {
    const cfg = buildService();
    expect(cfg.tracker.autoAcceptConfidenceThreshold).toBe(0.75); // code-default
    cfg.hydrateSync([['tracker.autoAcceptConfidenceThreshold', 0.6]]);
    expect(cfg.tracker.autoAcceptConfidenceThreshold).toBe(0.6);
  });

  it('entityGraphMinComentions / themeClusteringMinBlocks / themeClusterMinSize — code-defaults под малый тенант', () => {
    const cfg = buildService();
    expect(cfg.knowledgeCore.entityGraphMinComentions).toBe(2);
    expect(cfg.knowledgeCore.themeClusteringMinBlocks).toBe(10);
    expect(cfg.knowledgeCore.themeClusterMinSize).toBe(3);
  });

  it('v2AgentsEnabled — master-флаг через ENV, НЕ admin-крутилка: applySync его НЕ меняет', () => {
    // Намеренно: v2AgentsEnabled читается через this.get(ENV), а не resolveSync.
    // seed выставляет knowledge.v2AgentsEnabled=true, ENV-дефолт=false; если бы
    // getter читал AdminSetting первым — v2-агенты включились бы на засеянном
    // проде (текущее поведение OFF). Включение v2 — отдельное осознанное решение.
    const cfg = buildService({ KNOWLEDGE_CORE_V2_AGENTS_ENABLED: false });
    expect(cfg.knowledgeCore.v2AgentsEnabled).toBe(false); // ENV
    cfg.applySync('knowledge.v2AgentsEnabled', true);
    expect(cfg.knowledgeCore.v2AgentsEnabled).toBe(false); // applySync НЕ перебивает ENV
  });
});
