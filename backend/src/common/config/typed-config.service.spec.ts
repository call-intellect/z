import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import { TypedConfigService } from './typed-config.service';

function buildService(envMap: Record<string, unknown> = {}): TypedConfigService {
  const raw = {
    get: vi.fn((key: string) => envMap[key]),
  } as unknown as ConfigService;
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
    expect(() => cfg.resolveSync<number>('limits.maxX')).toThrow(/не найден ни в cache, ни в ENV/);
  });

  it('resolveSync возвращает undefined, если envFallbackKey передан, но ни ENV-значения, ни default нет (Фаза 4 — optional ENV)', () => {
    const cfg = buildService();
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
    cfg.applySync('limits.maxX', 100);
    expect(cfg.resolveSync<number>('limits.maxX', 'MAX_X', 1)).toBe(100);
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

    cfg.hydrateSync([['limits.maxY', 'second']]);
    expect(cfg.resolveSync<string>('limits.maxY', 'MAX_Y', 'd')).toBe('second');
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
    expect(cfg.auth.sessionTtlSeconds).toBe(3_600);
    expect(cfg.auth.deepLinkTtlSeconds).toBe(600);
  });
});

describe('embeddings + aiFeatures — sync resolve (Фаза 4)', () => {
  it('embeddings cacheMap override: hydrateSync задаёт dimensions → cfg.ai.embeddings.dimensions отдаёт его', () => {
    const cfg = buildService({
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
    const cfg = buildService({ LINKER_MIN_BLOCKS: 50 });
    expect(cfg.knowledgeCore.linkerMinBlocks).toBe(50);
    cfg.applySync('knowledge.linkerMinBlocks', 3);
    expect(cfg.knowledgeCore.linkerMinBlocks).toBe(3);
  });

  it('linkerMinBlocks — code-default 3, когда нет ни cache, ни ENV', () => {
    const cfg = buildService();
    expect(cfg.knowledgeCore.linkerMinBlocks).toBe(3);
  });

  it('linkMinConfidence — крутилка ЖИВАЯ: hydrateSync override побеждает ENV-дефолт', () => {
    const cfg = buildService({ LINK_MIN_CONFIDENCE: 0.75 });
    expect(cfg.knowledgeCore.linkMinConfidence).toBe(0.75);
    cfg.hydrateSync([['knowledge.linkMinConfidence', 0.5]]);
    expect(cfg.knowledgeCore.linkMinConfidence).toBe(0.5);
  });

  it('tracker.autoAcceptConfidenceThreshold — code-default 0.75 + ЖИВАЯ крутилка (hydrateSync побеждает)', () => {
    const cfg = buildService();
    expect(cfg.tracker.autoAcceptConfidenceThreshold).toBe(0.75);
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
    const cfg = buildService({ KNOWLEDGE_CORE_V2_AGENTS_ENABLED: false });
    expect(cfg.knowledgeCore.v2AgentsEnabled).toBe(false);
    cfg.applySync('knowledge.v2AgentsEnabled', true);
    expect(cfg.knowledgeCore.v2AgentsEnabled).toBe(false);
  });
});

describe('WP-I — крутилки нарезки block-ingest + рубильник combo (resolveSync)', () => {
  it('blockIngestWindowSegments — admin override побеждает ENV', () => {
    const cfg = buildService({ BLOCK_INGEST_WINDOW_SEGMENTS: 12 });
    expect(cfg.knowledgeCore.blockIngestWindowSegments).toBe(12);
    cfg.hydrateSync([['knowledge.blockIngestWindowSegments', 5]]);
    expect(cfg.knowledgeCore.blockIngestWindowSegments).toBe(5);
  });

  it('blockIngestMaxTokensPerSegment — code-default 2000, когда нет ни cache, ни ENV', () => {
    const cfg = buildService();
    expect(cfg.knowledgeCore.blockIngestMaxTokensPerSegment).toBe(2000);
    cfg.hydrateSync([['knowledge.blockIngestMaxTokensPerSegment', 1800]]);
    expect(cfg.knowledgeCore.blockIngestMaxTokensPerSegment).toBe(1800);
  });

  it('specialistsCombined.enabled — admin override knowledge.specialists_combined_enabled побеждает ENV', () => {
    const cfg = buildService({ SPECIALISTS_COMBINED_ENABLED: true });
    expect(cfg.specialistsCombined.enabled).toBe(true);
    cfg.hydrateSync([['knowledge.specialists_combined_enabled', false]]);
    expect(cfg.specialistsCombined.enabled).toBe(false);
  });

  it('specialistsCombined.delayMs — code-default 90000, admin override побеждает', () => {
    const cfg = buildService();
    expect(cfg.specialistsCombined.delayMs).toBe(90_000);
    cfg.applySync('knowledge.specialistsCombinedDelayMs', 30_000);
    expect(cfg.specialistsCombined.delayMs).toBe(30_000);
  });
});
