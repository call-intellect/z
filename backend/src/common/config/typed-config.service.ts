import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';

/**
 * Минимальный интерфейс `AdminSettingsService`, чтобы не импортировать
 * сам класс (живёт в `modules/admin/`, а это `common/` — нельзя плодить
 * круговую зависимость). На рантайме провайдер достаётся через
 * `ModuleRef.get(...)` по строковому токену.
 */
export interface DynamicAdminSettingsReader {
  get<T>(key: string, defaultValue?: T): Promise<T | undefined>;
}

/**
 * DI-токен для строковой резолвинга через ModuleRef. Если провайдер не
 * зарегистрирован (например в тестах без AdminSettingsModule) — `getDynamic`
 * мягко падает на ENV/default. Совпадает с именем класса для удобства DI:
 * `provide: 'AdminSettingsService'` или авторегистрация по классу-токену —
 * в обоих случаях lookup сработает.
 */
export const ADMIN_SETTINGS_READER_TOKEN = 'AdminSettingsService' as const;

/**
 * Типизированная обёртка над `ConfigService`.
 * Группирует ENV по логическим разделам:
 *   cfg.runtime, cfg.db, cfg.redis, cfg.auth, cfg.cors, cfg.livekit,
 *   cfg.turn, cfg.s3, cfg.ai.*, cfg.crossmark, cfg.retention, cfg.idle,
 *   cfg.quotas, cfg.admin.
 *
 * Использовать ВЕЗДЕ вместо `process.env.*`.
 */
@Injectable()
export class TypedConfigService {
  private readonly logger = new Logger(TypedConfigService.name);
  /**
   * Кеш AdminSettingsService на инстанс. lazy resolve через ModuleRef один раз
   * (повторные lookup'ы при отсутствии — без шума в логе).
   */
  private adminReader: DynamicAdminSettingsReader | null | undefined = undefined;

  /**
   * Sync-кэш AdminSetting-значений. Заливается на старте процесса через
   * `AdminSettingsBootstrapService` → `hydrateSync(...)`. Обновляется на лету
   * из `AdminSettingsService.set()` локально и из Redis pub/sub (другие
   * процессы) через `applySync(key, value)`.
   *
   * Существует, чтобы `resolveSync(...)` мог быть sync — вызывается из
   * `@Cron`, guard'ов и конструкторов сервисов, где async неприемлем.
   */
  private readonly cacheMap = new Map<string, unknown>();
  /** Один раз на (key, source) логируем источник, чтобы не спамить debug. */
  private readonly resolveSourceLogged = new Set<string>();

  constructor(
    // NB: убрали generic ConfigService<Env, true> — на агрегированной схеме
    // (~50 .merge), Env-union триггерит TS2589 ещё при объявлении конструктора.
    // Типизация Env-значений делается на уровне приватного `get` ниже.
    @Inject(ConfigService) private readonly raw: ConfigService,
    @Optional() @Inject(ModuleRef) private readonly moduleRef: ModuleRef | null = null,
  ) {}

  /**
   * NB: на длинной `.merge` цепочке EnvSchema (~50 разделов) generic-вывод
   * `keyof Env` форсит TS пробежаться по всем литералам ключей одновременно —
   * вылет TS2589 (excessively deep). Решение: принимаем key как `string`,
   * cast'им результат через `unknown`. Caller типизирует через локальную
   * аннотацию переменной (нет потери проверок на месте использования).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private get(key: string): any {
    return (this.raw as unknown as { get(k: string): unknown }).get(key);
  }

  // ─────────────────────────── runtime ───────────────────────────
  get runtime() {
    return {
      nodeEnv: this.get('NODE_ENV'),
      port: this.get('PORT'),
      logLevel: this.get('LOG_LEVEL'),
      isProduction: this.get('NODE_ENV') === 'production',
      isDevelopment: this.get('NODE_ENV') === 'development',
      isTest: this.get('NODE_ENV') === 'test',
    } as const;
  }

  // ─────────────────────────── logging (LoggingModule defaults) ──
  /**
   * Env-дефолты технического логирования. Используются `LogSettingsService`
   * как base при старте; в рантайме переопределяются через PATCH-настройки
   * (`PlatformSetting[logging_settings]`). См. plans/tz/2026-06-01-logging-module.md.
   */
  get logging() {
    return {
      dbLoggingEnabled: this.get('LOG_DB_ENABLED'),
      minLevel: this.get('LOG_DB_MIN_LEVEL'),
      batchSize: this.get('LOG_DB_BATCH_SIZE'),
      flushIntervalMs: this.get('LOG_DB_FLUSH_INTERVAL_MS'),
      maxBufferSize: this.get('LOG_DB_MAX_BUFFER'),
      retentionDays: this.get('LOG_DB_RETENTION_DAYS'),
      logStackTraces: this.get('LOG_DB_STACK_TRACES'),
      requestBodyLogging: this.get('LOG_DB_REQUEST_BODY'),
      responseBodyLogging: this.get('LOG_DB_RESPONSE_BODY'),
      logSuccessfulRequests: this.get('LOG_DB_SUCCESS_REQUESTS'),
      slowRequestThresholdMs: this.get('LOG_DB_SLOW_REQUEST_MS'),
    } as const;
  }

  // ─────────────────────────── db / redis ────────────────────────
  get db() {
    return {
      url: this.get('DATABASE_URL'),
    } as const;
  }

  get redis() {
    return {
      url: this.get('REDIS_URL'),
    } as const;
  }

  // ─────────────────────────── auth ───────────────────────────────
  get auth() {
    const rawDomain = this.get('COOKIE_DOMAIN');
    const standaloneRaw = this.get('COOKIE_STANDALONE_DOMAIN') ?? rawDomain;
    // Для localhost браузеры (Chrome/Edge/Safari) не принимают cookie
    // с Domain=.localhost — игнорируют. В dev возвращаем undefined,
    // чтобы express не выставлял атрибут Domain — cookie будет привязан
    // к origin (localhost).
    const isLocal = (d: string) =>
      d === 'localhost' || d === '.localhost' || d.endsWith('.localhost');
    return {
      sessionSecret: this.get('JWT_SESSION_SECRET'),
      deepLinkSecret: this.get('JWT_DEEP_LINK_SECRET'),
      cookieDomain: isLocal(rawDomain) ? undefined : rawDomain,
      cookieStandaloneDomain: isLocal(standaloneRaw) ? undefined : standaloneRaw,
      publicFrontendUrl: this.get('PUBLIC_FRONTEND_URL'),
      // Фаза 3 — TTL'ы переехали в AdminSetting (security.*). Секреты/
      // cookieDomain/publicFrontendUrl остаются ENV-only (см. ТЗ §3 — auth).
      sessionTtlSeconds: this.resolveSync<number>(
        'security.sessionTtlSeconds',
        'SESSION_TTL_SECONDS',
        86_400,
      ),
      deepLinkTtlSeconds: this.resolveSync<number>(
        'security.deepLinkTtlSeconds',
        'DEEP_LINK_TTL_SECONDS',
        900,
      ),
    } as const;
  }

  // ─────────────────────────── argon (standalone passwords) ─────
  /**
   * Фаза 3 env-to-admin-setting-call-sites-migration: каждое поле через
   * resolveSync(security.argonX, ARGON_X, default). AdminSetting'и
   * сидятся в `seed-admin-settings.ts` под префиксом `security.argon*`.
   */
  get argon() {
    return {
      memoryKb: this.resolveSync<number>(
        'security.argonMemoryKb',
        'ARGON_MEMORY_KB',
        19_456,
      ),
      iterations: this.resolveSync<number>(
        'security.argonIterations',
        'ARGON_ITERATIONS',
        2,
      ),
      parallelism: this.resolveSync<number>(
        'security.argonParallelism',
        'ARGON_PARALLELISM',
        1,
      ),
    } as const;
  }

  // ─────────────────────────── mail (SMTP) ──────────────────────
  get mail() {
    return {
      host: this.get('MAIL_HOST'),
      port: this.get('MAIL_PORT'),
      ssl: this.get('MAIL_SSL'),
      username: this.get('MAIL_USERNAME'),
      password: this.get('MAIL_PASSWORD'),
      from: this.get('MAIL_FROM'),
      fromName: this.get('MAIL_FROM_NAME'),
      dryRun: this.get('MAIL_DRY_RUN'),
    } as const;
  }

  // ─────────────────────────── cors ───────────────────────────────
  /**
   * Источник CORS — `PUBLIC_FRONTEND_URL`. В dev добавляем localhost.
   */
  get cors() {
    const allowed: string[] = [this.get('PUBLIC_FRONTEND_URL')];
    if (this.runtime.isDevelopment) {
      allowed.push('http://localhost:3000', 'http://localhost:3001');
    }
    return { allowed } as const;
  }

  // ─────────────────────────── livekit ───────────────────────────
  get livekit() {
    return {
      apiUrl: this.get('LIVEKIT_API_URL'),
      apiKey: this.get('LIVEKIT_API_KEY'),
      apiSecret: this.get('LIVEKIT_API_SECRET'),
      webhookApiKey: this.get('LIVEKIT_WEBHOOK_API_KEY'),
      webhookApiSecret: this.get('LIVEKIT_WEBHOOK_API_SECRET'),
      // Ack-first обработка вебхуков (opt-in, дефолт OFF). См. env.schema.ts.
      webhookAckFirstEnabled: this.resolveSync<boolean>(
        'livekit.webhookAckFirstEnabled',
        'LIVEKIT_WEBHOOK_ACK_FIRST_ENABLED',
        false,
      ),
    } as const;
  }

  // ─────────────────────────── turn ───────────────────────────────
  get turn() {
    return {
      mode: this.get('TURN_MODE'),
      host: this.get('TURN_HOST'),
      port: this.get('TURN_PORT'),
      username: this.get('TURN_USERNAME'),
      password: this.get('TURN_PASSWORD'),
      tls: this.get('TURN_TLS'),
    } as const;
  }

  // ─────────────────────────── s3 ─────────────────────────────────
  get s3() {
    return {
      endpointUrl: this.get('S3_ENDPOINT_URL'),
      region: this.get('S3_REGION'),
      bucket: this.get('S3_BUCKET'),
      accessKey: this.get('S3_ACCESS_KEY'),
      secretKey: this.get('S3_SECRET_KEY'),
      presignedTtlSeconds: this.get('S3_PRESIGNED_TTL_SECONDS'),
    } as const;
  }

  // ─────────────────────────── llm router ─────────────────────────
  /**
   * audit С30 (2026-05-29): глобальные настройки `LlmRouterService`
   * (cross-cutting, не привязаны к конкретному LLM-провайдеру).
   */
  get llmRouter() {
    return {
      /** Hard-timeout на один dispatch к провайдеру в ms. */
      dispatchTimeoutMs: this.get('LLM_ROUTER_DISPATCH_TIMEOUT_MS'),
    } as const;
  }

  /**
   * Ф6 Часть 3 — наблюдаемость доли prompt-cache хитов (DeepSeek).
   * Крутилки admin-editable (resolveSync: cacheMap → default; ENV не вводим).
   * Только лог/метрика — безопасно (best-effort smoke, ничего не блокирует).
   */
  get llm() {
    return {
      /** Включает smoke-проверку cache hit-ratio в provider-smoke-test cron. */
      cacheSmokeEnabled: this.resolveSync<boolean>(
        'llm.cacheSmokeEnabled',
        undefined,
        true,
      ),
      /**
       * Порог доли cache-хитов по DeepSeek: ниже — WARN в логи (возможно
       * taskType ушёл на некэширующий провайдер). Доля 0..1, дефолт 0.6.
       */
      cacheHitRatioWarnThreshold: this.resolveSync<number>(
        'llm.cacheHitRatioWarnThreshold',
        undefined,
        0.6,
      ),
    } as const;
  }

  // ─────────────────────────── ai ─────────────────────────────────
  get ai() {
    return {
      anthropic: {
        apiKey: this.get('ANTHROPIC_API_KEY'),
        model: this.get('ANTHROPIC_MODEL'),
        useProxy: this.get('ANTHROPIC_USE_PROXY'),
        proxyUrl: this.get('ANTHROPIC_PROXY_URL'),
      },
      vox: {
        apiUrl: this.get('VOX_API_URL'),
        apiToken: this.get('VOX_API_TOKEN'),
        model: this.get('VOX_MODEL'),
        language: this.get('VOX_LANGUAGE'),
        punctuationMode: this.get('VOX_PUNCTUATION_MODE'),
        pollIntervalMs: this.get('VOX_POLL_INTERVAL_MS'),
        pollMaxAttempts: this.get('VOX_POLL_MAX_ATTEMPTS'),
      },
      openai: {
        apiKey: this.get('OPENAI_API_KEY'),
        baseUrl: this.get('OPENAI_BASE_URL'),
      },
      deepseek: {
        apiKey: this.get('DEEPSEEK_API_KEY'),
        baseUrl: this.get('DEEPSEEK_BASE_URL'),
        defaultModel: this.get('DEEPSEEK_DEFAULT_MODEL'),
        // ТЗ-3 Фаза 3 — форс synthetic-tool через tool_choice для не-thinking
        // моделей при autoConvert. Дефолт ON (Ship-On, retest3 #56): kill-switch.
        // Guard в deepseek.service откатывает на 'auto' при format-400 прокси.
        forceToolChoiceEnabled: this.resolveSync<boolean>(
          'ai.deepseek.forceToolChoiceEnabled',
          'LLM_DEEPSEEK_FORCE_TOOL_CHOICE_ENABLED',
          true,
        ),
      },
      ollama: {
        baseUrl: this.get('OLLAMA_BASE_URL'),
        apiKey: this.get('OLLAMA_API_KEY'),
      },
      minimax: {
        apiKey: this.get('MINIMAX_API_KEY'),
        baseUrl: this.get('MINIMAX_BASE_URL'),
      },
      // retest3 Ф5 #51/Р3 — основной провайдер главного отчёта встречи
      // (LlmFallbackService). 'deepseek' (Ship-On) | 'minimax' (kill-switch-откат).
      mainReport: {
        primary: this.get('LLM_MAIN_REPORT_PRIMARY'),
      },
      grsai: {
        apiKey: this.get('GRSAI_API_KEY'),
        baseUrl: this.get('GRSAI_BASE_URL'),
      },
      kie: {
        apiKey: this.get('KIE_API_KEY'),
        baseUrl: this.get('KIE_BASE_URL'),
      },
      proxy: {
        baseUrl: this.get('PROXY_BASE_URL'),
        prefix: this.get('PROXY_PREFIX'),
      },
      // Фаза 4 env-to-admin-setting-call-sites-migration: 8 полей через
      // resolveSync(adminKey, envFallbackKey, default) под префиксом
      // `embeddings.*`. `proxyApiKey` остаётся ENV (секрет).
      embeddings: {
        provider: this.resolveSync<string>(
          'embeddings.provider',
          'EMBEDDING_PROVIDER',
          'openai-via-proxy',
        ),
        model: this.resolveSync<string>(
          'embeddings.model',
          'EMBEDDING_MODEL',
          'text-embedding-3-small',
        ),
        dimensions: this.resolveSync<number>(
          'embeddings.dimensions',
          'EMBEDDING_DIMENSIONS',
          1536,
        ),
        proxyApiKey: this.get('OPENAI_PROXY_API_KEY'),
        proxyEmbeddingsUrl: this.resolveSync<string>(
          'embeddings.proxyEmbeddingsUrl',
          'OPENAI_PROXY_EMBEDDINGS_URL',
          'https://proxy.agent-lia.ru/v1/embeddings',
        ),
        fallbackLocalUrl: this.resolveSync<string | undefined>(
          'embeddings.fallbackLocalUrl',
          'EMBEDDING_FALLBACK_LOCAL_URL',
        ),
        batchSize: this.resolveSync<number>(
          'embeddings.batchSize',
          'EMBEDDING_BATCH_SIZE',
          100,
        ),
        chunkTargetTokens: this.resolveSync<number>(
          'embeddings.chunkTargetTokens',
          'EMBEDDING_CHUNK_TARGET_TOKENS',
          400,
        ),
        chunkOverlapTokens: this.resolveSync<number>(
          'embeddings.chunkOverlapTokens',
          'EMBEDDING_CHUNK_OVERLAP_TOKENS',
          50,
        ),
      },
    } as const;
  }

  // ─────────────────────────── crossmark ─────────────────────────
  get crossmark() {
    return {
      hmacTimestampWindowSeconds: this.resolveSync<number>(
        'crossmark.hmacTimestampWindowSeconds',
        'CROSSMARK_HMAC_TIMESTAMP_WINDOW_SECONDS',
        300,
      ),
    } as const;
  }

  // ─────────────────────────── retention ─────────────────────────
  /**
   * Фаза 3 env-to-admin-setting-call-sites-migration: каждое поле читается
   * через `resolveSync(adminKey, envFallbackKey, default)` — cacheMap →
   * ENV → default. AdminSetting'и сидятся в `seed-admin-settings.ts`
   * под префиксом `retention.*`.
   */
  get retention() {
    return {
      defaultDays: this.resolveSync<number>(
        'retention.defaultDays',
        'DEFAULT_RETENTION_DAYS',
        30,
      ),
      cron: this.resolveSync<string>(
        'retention.cron',
        'RETENTION_CRON',
        '0 * * * *',
      ),
      softDeleteGraceDays: this.resolveSync<number>(
        'retention.softDeleteGraceDays',
        'SOFT_DELETE_GRACE_DAYS',
        30,
      ),
      webhookDeliveryDays: this.resolveSync<number>(
        'retention.webhookDeliveryDays',
        'WEBHOOK_DELIVERY_RETENTION_DAYS',
        30,
      ),
      shareViewDays: this.resolveSync<number>(
        'retention.shareViewDays',
        'SHARE_VIEW_RETENTION_DAYS',
        90,
      ),
      apiAccessLogDays: this.resolveSync<number>(
        'retention.apiAccessLogDays',
        'API_ACCESS_LOG_RETENTION_DAYS',
        30,
      ),
      // ── Фаза 11: knowledge-core retention sweeps ──
      sweepBatchSize: this.resolveSync<number>(
        'retention.sweepBatchSize',
        'RETENTION_SWEEP_BATCH_SIZE',
        500,
      ),
      rawEventsEnabled: this.resolveSync<boolean>(
        'retention.rawEventsEnabled',
        'RETENTION_RAW_EVENTS_ENABLED',
        false,
      ),
      auditEnabled: this.resolveSync<boolean>(
        'retention.auditEnabled',
        'RETENTION_AUDIT_ENABLED',
        false,
      ),
      chatEnabled: this.resolveSync<boolean>(
        'retention.chatEnabled',
        'RETENTION_CHAT_ENABLED',
        true,
      ),
      blocksEnabled: this.resolveSync<boolean>(
        'retention.blocksEnabled',
        'RETENTION_BLOCKS_ENABLED',
        false,
      ),
    } as const;
  }

  // ─────────────────────────── webhooks-out ──────────────────────
  get webhooksOut() {
    return {
      encryptionKey: this.get('WEBHOOK_SECRETS_ENCRYPTION_KEY'),
      deliveryTimeoutMs: this.resolveSync<number>(
        'webhook.deliveryTimeoutMs',
        'WEBHOOK_DELIVERY_TIMEOUT_MS',
        10_000,
      ),
      maxAttempts: this.resolveSync<number>(
        'webhook.maxAttempts',
        'WEBHOOK_MAX_ATTEMPTS',
        8,
      ),
      egressAllowedHosts: this.resolveSync<string>(
        'webhook.egressAllowedHosts',
        'WEBHOOK_EGRESS_ALLOWED_HOSTS',
        '',
      )
        .split(',')
        .map((h: string) => h.trim())
        .filter(Boolean),
    } as const;
  }

  // ─────────────────────────── workspace limits / quotas ────────
  /**
   * Фаза 2 env-to-admin-setting-call-sites-migration: каждое поле читается
   * через `resolveSync(adminKey, envFallbackKey, default)` — cacheMap →
   * ENV → default. AdminSetting'и сидятся в `seed-admin-settings.ts`
   * под префиксом `limits.*`.
   */
  get workspace() {
    return {
      clipMaxDurationSeconds: this.resolveSync<number>(
        'limits.clipMaxDurationSeconds',
        'CLIP_MAX_DURATION_SECONDS',
        300,
      ),
      exportZipMaxMeetings: this.resolveSync<number>(
        'limits.exportZipMaxMeetings',
        'EXPORT_ZIP_MAX_MEETINGS',
        100,
      ),
      exportZipMaxBytes: this.resolveSync<number>(
        'limits.exportZipMaxBytes',
        'EXPORT_ZIP_MAX_SIZE_BYTES',
        21_474_836_480,
      ),

      maxApiKeysPerUser: this.resolveSync<number>(
        'limits.maxApiKeysPerUser',
        'MAX_API_KEYS_PER_USER',
        10,
      ),
      maxWebhookSubscriptionsPerUser: this.resolveSync<number>(
        'limits.maxWebhookSubscriptionsPerUser',
        'MAX_WEBHOOK_SUBSCRIPTIONS_PER_USER',
        20,
      ),
      maxDestinationsPerUser: this.resolveSync<number>(
        'limits.maxDestinationsPerUser',
        'MAX_DESTINATIONS_PER_USER',
        20,
      ),
      maxTagsPerUser: this.resolveSync<number>(
        'limits.maxTagsPerUser',
        'MAX_TAGS_PER_USER',
        50,
      ),
      maxUserTemplatesPerUser: this.resolveSync<number>(
        'limits.maxUserTemplatesPerUser',
        'MAX_USER_TEMPLATES_PER_USER',
        20,
      ),

      maxChatRequestsPerDay: this.resolveSync<number>(
        'limits.maxChatRequestsPerDay',
        'MAX_CHAT_REQUESTS_PER_DAY',
        200,
      ),
      maxChatTokensPerDay: this.resolveSync<number>(
        'limits.maxChatTokensPerDay',
        'MAX_CHAT_TOKENS_PER_DAY',
        2_000_000,
      ),
      maxRenderJobsPerHour: this.resolveSync<number>(
        'limits.maxRenderJobsPerHour',
        'MAX_RENDER_JOBS_PER_HOUR',
        10,
      ),
      maxBulkExportsPerDay: this.resolveSync<number>(
        'limits.maxBulkExportsPerDay',
        'MAX_BULK_EXPORTS_PER_DAY',
        5,
      ),
      maxRegeneratePerMeetingPerDay: this.resolveSync<number>(
        'limits.maxRegeneratePerMeetingPerDay',
        'MAX_REGENERATE_PER_MEETING_PER_DAY',
        5,
      ),
      maxMeetingsCreatedPerDayViaApi: this.resolveSync<number>(
        'limits.maxMeetingsCreatedPerDayViaApi',
        'MAX_MEETINGS_CREATED_PER_DAY_VIA_API',
        100,
      ),
      maxEmbeddingTokensPerMonth: this.resolveSync<number>(
        'limits.maxEmbeddingTokensPerMonthPerUser',
        'MAX_EMBEDDING_TOKENS_PER_MONTH_PER_USER',
        10_000_000,
      ),

      maxHighlightsPerMeeting: this.resolveSync<number>(
        'limits.maxHighlightsPerMeeting',
        'MAX_HIGHLIGHTS_PER_MEETING',
        50,
      ),
      maxBulkOperationIds: this.resolveSync<number>(
        'limits.maxBulkOperationIds',
        'MAX_BULK_OPERATION_IDS',
        200,
      ),
      maxChatMessageChars: this.resolveSync<number>(
        'limits.maxChatMessageChars',
        'MAX_CHAT_MESSAGE_CHARS',
        8_000,
      ),
      maxRoomMessageChars: this.resolveSync<number>(
        'limits.maxRoomMessageChars',
        'MAX_ROOM_MESSAGE_CHARS',
        2_000,
      ),

      maxCardsPerUser: this.resolveSync<number>(
        'limits.maxCardsPerUser',
        'MAX_CARDS_PER_USER',
        500,
      ),
      maxCardRollupsPerDay: this.resolveSync<number>(
        'limits.maxCardRollupsPerDay',
        'MAX_CARD_ROLLUPS_PER_DAY',
        100,
      ),
      /** Phase 9: ручной пересчёт strategic-alignment по Goal (на Org). */
      maxGoalRecomputePerDay: this.resolveSync<number>(
        'limits.maxGoalRecomputePerDay',
        'MAX_GOAL_RECOMPUTE_PER_DAY',
        5,
      ),
    } as const;
  }

  // ─────────────────────────── ai feature flags ─────────────────
  /**
   * Feature-flags AI-pipeline. Отдельный геттер, чтобы не раздувать
   * `cfg.ai` (там и так много провайдеров).
   */
  get aiFeatures() {
    return {
      includeRoomChat: this.resolveSync<boolean>(
        'aiFeatures.includeRoomChat',
        'INCLUDE_ROOM_CHAT_IN_AI',
        true,
      ),
      /**
       * Фаза D (sub-TZ §6.2) — включает LLM-уточнение уровня 2 в воркере
       * `ai.transcript-clean`. При false воркер работает только через
       * детерминистский уровень 1.
       */
      transcriptCleaningLlmRefine: this.resolveSync<boolean>(
        'aiFeatures.transcriptCleaningLlmRefine',
        'TRANSCRIPT_CLEANING_LLM_REFINE_ENABLED',
        true,
      ),
      /**
       * Фаза B (sub-TZ 2026-05-21-phase-B §7) — включает LLM-refine
       * в воркере `ai.behavior-metrics`. По умолчанию false.
       */
      behaviorMetricsLlmRefine: this.resolveSync<boolean>(
        'aiFeatures.behaviorMetricsLlmRefine',
        'BEHAVIOR_METRICS_LLM_REFINE_ENABLED',
        false,
      ),
      /**
       * ТЗ 2026-05-24 §4 (F1) — мастер-флаг защиты от prompt-injection.
       * При true (default) customPrompt идёт в user внутри маркеров +
       * INJECTION_GUARD_NOTE в system. При false — legacy-поведение
       * (customPrompt напрямую в system) для быстрого rollback.
       */
      promptInjectionGuardEnabled: this.resolveSync<boolean>(
        'aiFeatures.promptInjectionGuardEnabled',
        'PROMPT_INJECTION_GUARD_ENABLED',
        true,
      ),
      /**
       * ТЗ 2026-06-07 agent-chain-overhaul, Фаза 5 / Р6 — флаг legacy
       * summary-агента (analyze.worker `runSummary`, MiniMax, 0% кэш). При
       * `true` (default) агент работает как раньше — обратимо, ничего не ломает.
       * Каноническая сводка теперь идёт из meeting-report-fast (`summaryFast`);
       * после подтверждения покрытия `summaryFast` можно выставить `false` —
       * это `−1` LLM-вызов MiniMax (ops-решение).
       */
      summaryAgentEnabled: this.resolveSync<boolean>(
        'aiFeatures.summaryAgentEnabled',
        'SUMMARY_AGENT_ENABLED',
        true,
      ),
    } as const;
  }

  get hashing() {
    return {
      ipDailySalt: this.get('IP_HASH_DAILY_SALT'),
    } as const;
  }

  get share() {
    return {
      tokenLengthBytes: this.resolveSync<number>(
        'share.tokenLengthBytes',
        'SHARE_TOKEN_LENGTH_BYTES',
        24,
      ),
      defaultExpirationDays: this.resolveSync<number>(
        'share.defaultExpirationDays',
        'SHARE_DEFAULT_EXPIRATION_DAYS',
        7,
      ),
      allowedExpirationDays: this.resolveSync<readonly number[]>(
        'share.allowedExpirationDays',
        'SHARE_ALLOWED_EXPIRATION_DAYS',
        [1, 7, 14],
      ),
    } as const;
  }

  // ─────────────────────────── ingest (Фаза 1 knowledge-core) ────
  get ingest() {
    return {
      internalToken: this.get('INGEST_INTERNAL_TOKEN'),
    } as const;
  }

  // ─────────────────────────── crypto (Фаза 10) ──────────────────
  get crypto() {
    return {
      masterKey: this.get('CRYPTO_MASTER_KEY'),
    } as const;
  }

  /**
   * Внешний хост backend'а — для регистрации webhook'ов адаптеров (Telegram,
   * Mango). Если PUBLIC_HOST_URL не задан, фолбэчимся на PUBLIC_FRONTEND_URL.
   */
  get publicHostUrl(): string {
    const host = this.get('PUBLIC_HOST_URL');
    if (host) return host.replace(/\/+$/, '');
    return this.get('PUBLIC_FRONTEND_URL').replace(/\/+$/, '');
  }

  // ─────────────────────────── email-fetch (Фаза 10) ─────────────
  get emailFetch() {
    return {
      enabled: this.resolveSync<boolean>(
        'emailFetch.enabled',
        'EMAIL_FETCH_ENABLED',
        false,
      ),
      cron: this.resolveSync<string>(
        'emailFetch.cron',
        'EMAIL_FETCH_CRON',
        '*/5 * * * *',
      ),
      maxPerRun: this.resolveSync<number>(
        'emailFetch.maxPerRun',
        'EMAIL_FETCH_MAX_PER_RUN',
        50,
      ),
    } as const;
  }

  // ─────────────────────────── mail-inbox (Tracker Phase 4, T5) ──
  /**
   * Общий IMAP-ящик `inbox.kora.app` для приёма писем на per-project
   * alias'ы (Email-to-task). Поллер: `ImapPollCron` → `ProjectInboxService`.
   *
   * `enabled=false` (default) полностью отключает cron — на dev'е писем не
   * подтягиваем (избегаем стука в продовый ящик при локальной разработке).
   */
  get mailInbox() {
    return {
      enabled: this.get('MAIL_INBOX_ENABLED'),
      domain: this.get('MAIL_INBOX_DOMAIN'),
      imapHost: this.get('MAIL_INBOX_IMAP_HOST'),
      imapPort: this.get('MAIL_INBOX_IMAP_PORT'),
      imapUser: this.get('MAIL_INBOX_IMAP_USER'),
      imapPass: this.get('MAIL_INBOX_IMAP_PASS'),
      imapTls: this.get('MAIL_INBOX_IMAP_TLS'),
      imapFolder: this.get('MAIL_INBOX_IMAP_FOLDER'),
      pollCron: this.get('MAIL_INBOX_POLL_CRON'),
      maxPerRun: this.get('MAIL_INBOX_MAX_PER_RUN'),
    } as const;
  }

  // ─────────────────────────── knowledge-core (Фаза 2+) ──────────
  get knowledgeCore() {
    return {
      distillMergeThreshold: this.get('DISTILL_MERGE_THRESHOLD'),
      distillDebounceMs: this.get('DISTILL_DEBOUNCE_MS'),
      distillKnnTopK: this.get('DISTILL_KNN_TOP_K'),
      entityMergeThreshold: this.get('ENTITY_MERGE_THRESHOLD'),
      entityResolverCron: this.get('ENTITY_RESOLVER_CRON'),
      blockIngestWindowSegments: this.get('BLOCK_INGEST_WINDOW_SEGMENTS'),
      blockIngestMaxTokensPerSegment: this.get('BLOCK_INGEST_MAX_TOKENS_PER_SEGMENT'),
      searchCosineWeight: this.get('SEARCH_COSINE_WEIGHT'),
      searchBm25Weight: this.get('SEARCH_BM25_WEIGHT'),
      // Фаза 3: связи и граф.
      // Пороги графа — admin-editable (resolveSync: cacheMap → ENV → default).
      // Дефолты выровнены под малый тенант и со seed-admin-settings.ts.
      // См. plans/tz/2026-06-04-razblokirovka-konveyera.md §Фаза 6.
      linkMinConfidence: this.resolveSync<number>(
        'knowledge.linkMinConfidence',
        'LINK_MIN_CONFIDENCE',
        0.5,
      ),
      linkerMinBlocks: this.resolveSync<number>(
        'knowledge.linkerMinBlocks',
        'LINKER_MIN_BLOCKS',
        3,
      ),
      linkKnnTopK: this.get('LINK_KNN_TOP_K'),
      reframingCron: this.get('REFRAMING_CRON'),
      blockDynamicScoreDecayDays: this.get('BLOCK_DYNAMIC_SCORE_DECAY_DAYS'),
      entityGraphBuilderCron: this.get('ENTITY_GRAPH_BUILDER_CRON'),
      entityGraphMinComentions: this.resolveSync<number>(
        'knowledge.entityGraphMinComentions',
        'ENTITY_GRAPH_MIN_COMENTIONS',
        2,
      ),
      // Фаза 4: Theme + card-rollup-v2.
      themeClustererCron: this.get('THEME_CLUSTERER_CRON'),
      themeClusteringMinBlocks: this.resolveSync<number>(
        'knowledge.themeClusteringMinBlocks',
        'THEME_CLUSTERING_MIN_BLOCKS',
        10,
      ),
      themeClusterMinSize: this.resolveSync<number>(
        'knowledge.themeClusterMinSize',
        'THEME_CLUSTER_MIN_SIZE',
        3,
      ),
      themeCosineThreshold: this.get('THEME_COSINE_THRESHOLD'),
      cardRollupV2DebounceMs: this.get('CARD_ROLLUP_V2_DEBOUNCE_MS'),
      // Фаза 5: meeting-analyze-v2 (Tasks-2.0/Chapters-2.0/Summary-2.0).
      // НАМЕРЕННО через this.get(ENV), НЕ resolveSync: seed выставляет
      // knowledge.v2AgentsEnabled=true, а ENV-дефолт=false; перевод на
      // resolveSync читал бы AdminSetting первым и ВКЛЮЧИЛ бы v2-агентов на
      // засеянном проде (текущее поведение — OFF). Это master-флаг фичи, а не
      // крутилка-порог малого тенанта — включать v2 должно быть отдельным
      // осознанным решением, не побочкой Фазы 6. См. §Фаза 6 МТЗ.
      v2AgentsEnabled: this.get('KNOWLEDGE_CORE_V2_AGENTS_ENABLED'),
      meetingAnalyzeV2Cron: this.get('MEETING_ANALYZE_V2_CRON'),
      meetingAnalyzeV2DebounceMs: this.get('MEETING_ANALYZE_V2_DEBOUNCE_MS'),
      // ТЗ 2026-05-25: meeting-report-fast — новая параллельная цепочка отчёта
      // на сыром транскрипте (один LLM-вызов). Включается флагом отдельно от
      // v2-агентов; producer — MergeWorker (после готовности транскрипта).
      meetingReportFastEnabled: this.get('MEETING_REPORT_FAST_ENABLED'),
      // Фаза 6: ChatV2 (единый AI-чат поверх IdeaBlock'ов).
      chatV2Enabled: this.get('CHAT_V2_ENABLED'),
      chatV2TopBlocks: this.get('CHAT_V2_TOP_BLOCKS'),
      chatV2GraphHops: this.get('CHAT_V2_GRAPH_HOPS'),
      // Agents v2 Фаза A1 (2026-05-30) — Bi-temporal edges retrieval filter.
      // При false (default) retrieval НЕ фильтрует edges по validFrom/validUntil.
      // См. plans/tz/2026-05-29-agents-v2-umbrella.md §A1.
      biTemporalEdgesEnabled: this.get('BI_TEMPORAL_EDGES_ENABLED'),
      // Ф1 idea direct-path (2026-06-08): block-ingest материализует Idea
      // напрямую из блока signalType='idea' (идемпотентно по sourceBlockId),
      // чтобы Идея не зависела на 100% от 2-го LLM-вызова Specialist 3.6.
      // Kill-switch (AdminSetting, дефолт ON) — откат без редеплоя при дублях.
      ideaDirectPathEnabled: this.resolveSync<boolean>(
        'knowledge.ideaDirectPathEnabled',
        undefined,
        true,
      ),
      // Ф5 Р2 (2026-06-08) — семантический дедуп задач встречи. РИСКОВО (может
      // скрыть задачу) → дефолт FALSE (data-affecting), включается осознанно.
      // `taskDedupeThreshold` — KNN cosine-порог уверенного слияния fast-черновика
      // в canonical (серая зона = [threshold-0.07, threshold) → LLM-арбитр).
      // Admin-editable (resolveSync: cacheMap → default; ENV не вводим — крутилка).
      taskDedupeEnabled: this.resolveSync<boolean>(
        'meetings.taskDedupeEnabled',
        undefined,
        false,
      ),
      taskDedupeThreshold: this.resolveSync<number>(
        'meetings.taskDedupeThreshold',
        undefined,
        0.85,
      ),
    } as const;
  }

  // ─────────────────────────── граф Apache AGE ────────────────────
  /**
   * МТЗ «разблокировка конвейера» Ф5 — настройки записи в граф Apache AGE.
   *
   *   - `ageEnabled` — kill-switch записи в `z_graph` через `cypher()`.
   *     При `false` все Cypher-вызовы GraphService — no-op (Postgres-часть
   *     работает как источник правды). Дефолт TRUE — граф критичен; switch
   *     для аварийного отключения при недоступности AGE на проде.
   *
   * Admin-editable (`resolveSync`: cacheMap → ENV → default). Дефолт TRUE,
   * seed TRUE, ENV TRUE — без флипа текущего поведения.
   */
  get graph() {
    return {
      ageEnabled: this.resolveSync<boolean>(
        'graph.ageEnabled',
        'GRAPH_AGE_ENABLED',
        true,
      ),
    } as const;
  }

  // ─────────────────────────── support desk (TZ 2026-06-09) ──────────
  /**
   * Вендорская служба поддержки (support-desk-clone Ф1).
   *
   *   - `enabled` — аварийный kill-switch. Дефолт TRUE (Ship-On). При FALSE
   *     `SupportIntakeService.createTicket` отдаёт 503 SUPPORT_DESK_DISABLED,
   *     а `SupportSlaCron` — no-op. Admin-editable (resolveSync: cacheMap →
   *     ENV `SUPPORT_DESK_ENABLED` → default). Параметр владельца, какая Org —
   *     вендор-деск, хранится отдельно в AdminSetting `support.vendor_org_id`
   *     (читается через `getDynamic`, не здесь — это не bool-флаг).
   */
  get supportDesk() {
    return {
      enabled: this.resolveSync<boolean>(
        'support_desk.enabled',
        'SUPPORT_DESK_ENABLED',
        true,
      ),
      // Ф4 kill-switch ночного куратора контура (no-op при false).
      curatorEnabled: this.resolveSync<boolean>(
        'support_desk.curator_enabled',
        'SUPPORT_CURATOR_ENABLED',
        true,
      ),
    } as const;
  }

  // ─────────────────────────── KC-Temporal Bitemporal ─────────────
  /**
   * KC-Temporal W1.1 (2026-05-25) — bi-temporal факты, supersede-арбитр.
   *
   *   - `enabled` — master kill-switch для всей Волны 1 (block-ingest
   *     заполняет validFrom, search фильтрует validUntil IS NULL).
   *   - `supersedeEnabled` — флаг W1.2 (FactSupersedeService), требует
   *     `enabled=true`. Раздельный — чтобы катить bitemporal-поля без LLM.
   *   - `factSignalTypes` — список signalType, на которых работает
   *     supersede-арбитр (см. решение №1 ТЗ).
   */
  get bitemporal() {
    const csv = this.get('BITEMPORAL_FACT_SIGNAL_TYPES') as string;
    const factSignalTypes = csv
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return {
      enabled: this.get('BITEMPORAL_ENABLED') as boolean,
      supersedeEnabled: this.get('BITEMPORAL_SUPERSEDE_ENABLED') as boolean,
      factSignalTypes,
      // KC-Temporal W1.2 — параметры FactSupersedeService.
      // Cosine threshold выше дефолта block-distill (0.92), потому что
      // supersede — закрытие блока, нужна высокая precision.
      factSupersedeCosineThreshold: this.get(
        'FACT_SUPERSEDE_COSINE_THRESHOLD',
      ) as number,
      factSupersedeKnnTopK: this.get('FACT_SUPERSEDE_KNN_TOP_K') as number,
      factSupersedeCostAlertPct: this.get(
        'FACT_SUPERSEDE_COST_ALERT_PCT',
      ) as number,
    } as const;
  }

  // ─────────────────────────── KC-Temporal W1.5 — Ingest-time KNN ──
  /**
   * Параметры синхронного resolver'а сущностей в block-ingest.worker'е
   * (`EntityResolutionService.findOrCreateEntity`):
   *   - `resolveThreshold` — cosine similarity, при котором без LLM
   *     возвращаем существующую сущность (короткое замыкание).
   *   - `cacheTtlSeconds` — TTL Redis-кеша resolved-сущности
   *     (`entity-resolve:${tenantId}:${type}:${sha1(lowerName)}`).
   */
  get entityIngest() {
    return {
      resolveThreshold: this.get('ENTITY_INGEST_RESOLVE_THRESHOLD') as number,
      cacheTtlSeconds: this.get('ENTITY_INGEST_RESOLVE_CACHE_TTL_S') as number,
    } as const;
  }

  // ─────────────────────────── KC-Temporal W3.5 — Projection rebuild ──
  /**
   * Параметры `ProjectionRebuilderService` (W3.5):
   *   - `debounceMs` — окно BullMQ-дедупа enqueue'а rebuild-job'а
   *     по jobId `projection-rebuild_<kind>_<id>`. Несколько подряд
   *     идущих `idea_block.updated` по одной проекции схлопнутся в один
   *     отложенный job. Default 5 мин.
   */
  get projectionRebuild() {
    return {
      debounceMs: this.get('PROJECTION_REBUILD_DEBOUNCE_MS') as number,
    } as const;
  }

  // ─────────────────────────── Agents v2 Фаза A2 — Multi-Agent Debate ──
  /**
   * Параметры `MultiAgentDebateService` (Agents v2 §A2).
   *
   *   - `enabled` — master kill-switch (на старте Specialist33Service.
   *     supersedeDetect использует одиночный LLM-вызов; при `true`
   *     дёргает debate-judge).
   *   - `defaultN` — сколько голосов в round 1 (3 = strict/empathetic/neutral).
   *   - `defaultRounds` — сколько round'ов всего (1 = только parallel).
   *   - `round2Enabled` — включать ли round 2 при split'е (1-1-1).
   *   - `costCapUsdPerRun` — budget cap на ОДИН debate-run.
   *
   * См. plans/tz/2026-05-29-agents-v2-umbrella.md §A2.
   */
  get debate() {
    return {
      enabled: this.get('MULTI_AGENT_DEBATE_ENABLED') as boolean,
      defaultN: this.get('DEBATE_DEFAULT_N') as number,
      defaultRounds: this.get('DEBATE_DEFAULT_ROUNDS') as number,
      round2Enabled: this.get('DEBATE_ROUND2_ENABLED') as boolean,
      costCapUsdPerRun: this.get('DEBATE_COST_CAP_USD_PER_RUN') as number,
    } as const;
  }

  // ─────────────────────────── Agents v2 Фаза B1 — AutoRule extract ──
  /**
   * Параметры `AutoRuleExtractorService` и `AutoRuleExtractCron`
   * (Agents v2 §B1, shadow mode).
   *
   *   - `enabled` — мастер-флаг cron'а. Default false; включаем после
   *     валидации на одной dev-Org.
   *   - `minFeedbackForExtract` — минимум PromptFeedback'ов на (promptKey ×
   *     tenant) за 24ч.
   *   - `minConfidenceForPromote` — порог confidence draft-правила, ниже
   *     которого PromptRule не создаётся (в Фазе B готовится для C).
   *   - `knnGroupThreshold` — cosine для KNN-группировки похожих feedback'ов.
   *   - `ruleSimilarityThreshold` — cosine, при котором новое rule — дубль
   *     existing.
   *
   * См. plans/tz/2026-05-29-agents-v2-umbrella.md §B1.
   */
  get autorule() {
    return {
      enabled: this.get('AUTORULE_ENABLED') as boolean,
      minFeedbackForExtract: this.get('AUTORULE_MIN_FEEDBACK_FOR_EXTRACT') as number,
      minConfidenceForPromote: this.get('AUTORULE_MIN_CONFIDENCE_FOR_PROMOTE') as number,
      knnGroupThreshold: this.get('AUTORULE_KNN_GROUP_THRESHOLD') as number,
      ruleSimilarityThreshold: this.get('AUTORULE_RULE_SIMILARITY_THRESHOLD') as number,
    } as const;
  }

  // ─────────────────────────── Agents v2 Фаза C1 — PracticeSkill ──
  /**
   * Параметры `PracticeSkillExtractor`/`Retrieval`/`Evaluator` сервисов
   * (Agents v2 §C1).
   *
   *   - `enabled` — мастер-флаг retrieval'а в clone-respond. Default false;
   *     extraction-cron всё равно работает (наполняет shadow), но в промпт
   *     skill'ы не подмешиваются, пока флаг не включат.
   *   - `minTraitsForExtract` — минимум активных SkillTrait в концепте,
   *     ниже которого extractor пропускает concept (рано извлекать procedure).
   *   - `shadowTrafficShare` — стартовый `trafficShare` для новых skill'ов.
   *   - `knnRetrievalThreshold` — cosine для поиска skill'ов по embedding'у
   *     вопроса в retrieval (clone-respond). 0.78 — баланс recall/precision.
   *   - `knnDedupThreshold` — cosine для dedup в extractor (≥ — не создавать
   *     новый, а обновить examples existing).
   *   - `evalMinRuns` — минимум SkillUsage за окно для evaluator gate.
   *   - `evalPromoteDelta` / `evalArchiveDelta` — пороги composite_score vs
   *     baseline для promote/archive (см. PracticeSkillEvaluatorCron).
   *
   * Безопасное чтение `this.get()` (через try/catch не нужен — get кидает
   * только при отсутствующем ENV, что для unit-тестов покрыто defaults).
   *
   * См. plans/tz/2026-05-29-agents-v2-umbrella.md §C1.
   */
  get practiceSkills() {
    return {
      enabled: this.get('PRACTICE_SKILLS_ENABLED') as boolean,
      minTraitsForExtract: this.get('PRACTICE_SKILLS_MIN_TRAITS_FOR_EXTRACT') as number,
      shadowTrafficShare: this.get('PRACTICE_SKILLS_SHADOW_TRAFFIC') as number,
      knnRetrievalThreshold: this.get('PRACTICE_SKILLS_KNN_RETRIEVAL_THRESHOLD') as number,
      knnDedupThreshold: this.get('PRACTICE_SKILLS_KNN_DEDUP_THRESHOLD') as number,
      evalMinRuns: this.get('PRACTICE_SKILLS_EVAL_MIN_RUNS') as number,
      evalPromoteDelta: this.get('PRACTICE_SKILLS_EVAL_PROMOTE_DELTA') as number,
      evalArchiveDelta: this.get('PRACTICE_SKILLS_EVAL_ARCHIVE_DELTA') as number,
    } as const;
  }

  // ─────────────────────────── Agents v2 Фаза C2 — GEPA ─────────────
  /**
   * Параметры `GepaRunnerService` + 3 cron'ов (optimize/promote/ab-monitor).
   *
   *   - `enabled` — мастер-флаг (PROMPT_EVOLUTION_ENABLED). Default false:
   *     даже если schema/код задеплоен, никаких cron-вызовов GEPA не будет.
   *   - `maxMetricCalls` — лимит rollouts в одном optimize'е.
   *   - `reflectionLm` / `taskLm` — модели для GEPA внутри Python (capable +
   *     reasoning, default deepseek-v4-pro).
   *   - `abTrafficShare` — доля трафика для тестируемого candidate (0..1).
   *   - `abMinInvocationsBeforeDecision` — минимум B-invocations перед
   *     принятием решения promote/reject в ab-monitor cron'е.
   *   - `abPromoteThreshold` / `abRejectThreshold` — Δ composite score.
   *   - `serviceUrl` — base URL gepa-сервиса (контейнер z-gepa, http://gepa:8000).
   *   - `timeoutMs` — hard-timeout HTTP-вызова /optimize (default 1ч).
   *
   * См. plans/tz/2026-05-29-agents-v2-umbrella.md §C2.
   */
  get gepa() {
    return {
      enabled: this.get('PROMPT_EVOLUTION_ENABLED') as boolean,
      maxMetricCalls: this.get('GEPA_MAX_METRIC_CALLS') as number,
      reflectionLm: this.get('GEPA_REFLECTION_LM') as string,
      taskLm: this.get('GEPA_TASK_LM') as string,
      abTrafficShare: this.get('GEPA_AB_TRAFFIC_SHARE') as number,
      abMinInvocationsBeforeDecision: this.get(
        'GEPA_AB_MIN_INVOCATIONS_BEFORE_DECISION',
      ) as number,
      abPromoteThreshold: this.get('GEPA_AB_PROMOTE_THRESHOLD') as number,
      abRejectThreshold: this.get('GEPA_AB_REJECT_THRESHOLD') as number,
      serviceUrl: this.get('GEPA_SERVICE_URL') as string,
      timeoutMs: this.get('GEPA_TIMEOUT_MS') as number,
    } as const;
  }

  // ─────────────────────────── SBA α-5 — Chat-v2 Omnichannel ─────
  /**
   * Конфигурация модуля `chat-v2/` (новая обёртка над knowledge-core
   * ChatV2Service с conversation history и omnichannel inbound/outbound).
   * См. plans/tz/2026-05-21-sba-alpha-5-layer5-chat-v2.md.
   */
  get chatV2() {
    return {
      historyMessages: this.get('CHAT_V2_HISTORY_MESSAGES'),
      conversationTtlDays: this.get('CHAT_V2_CONVERSATION_TTL_DAYS'),
      cleanupCron: this.get('CHAT_V2_CLEANUP_CRON'),
      defaultMode: this.get('CHAT_V2_DEFAULT_MODE'),
    } as const;
  }

  // ─────────────────────────── document-ingest (Фаза 0b) ────────
  get document() {
    const customBucket = this.get('S3_BUCKET_DOCUMENTS');
    return {
      parseTimeoutMs: this.get('DOCUMENT_PARSE_TIMEOUT_MS'),
      maxSizeMb: this.get('DOCUMENT_MAX_SIZE_MB'),
      maxSizeBytes: this.get('DOCUMENT_MAX_SIZE_MB') * 1024 * 1024,
      inlineThresholdMb: this.get('DOCUMENT_INLINE_THRESHOLD_MB'),
      inlineThresholdBytes:
        this.get('DOCUMENT_INLINE_THRESHOLD_MB') * 1024 * 1024,
      /**
       * Если `S3_BUCKET_DOCUMENTS` не задан — используем основной bucket.
       * На локальном MinIO так живём (один bucket на всё), на проде
       * рекомендуется отдельный bucket с другими retention/ACL.
       */
      s3Bucket: customBucket && customBucket.length > 0 ? customBucket : this.get('S3_BUCKET'),
    } as const;
  }

  /**
   * ТЗ-4 Ф6 — «живые» лимиты ручной загрузки документов (admin-editable).
   * Читаются через `getDynamic` (AdminSetting → ENV-fallback → default).
   *   - `maxSizeMb` — потолок размера одного файла (МБ).
   *   - `maxFilesPerUpload` — максимум файлов в одном multipart-запросе.
   *   - `acceptedFormats` — белый список расширений (`DocumentKind`-совместимый).
   *
   * Намеренно async (в отличие от sync-геттера `document`) — это
   * owner-decision крутилки, редактируемые из админки без рестарта.
   */
  async documentLimits(): Promise<{
    maxSizeMb: number;
    maxSizeBytes: number;
    maxFilesPerUpload: number;
    acceptedFormats: readonly string[];
    /** ТЗ-4 Ф7 — потолок размера ZIP-архива массового импорта (МБ). */
    maxZipSizeMb: number;
    maxZipSizeBytes: number;
  }> {
    const [maxSizeMb, maxFilesPerUpload, acceptedFormats, maxZipSizeMb] =
      await Promise.all([
        this.getDynamic<number>('documents.maxSizeMb', 'DOCUMENT_MAX_SIZE_MB', 50),
        this.getDynamic<number>('documents.maxFilesPerUpload', undefined, 20),
        this.getDynamic<readonly string[]>('documents.acceptedFormats', undefined, [
          'pdf',
          'docx',
          'xlsx',
          'pptx',
          'md',
          'txt',
          'html',
          'rtf',
          'odt',
          'csv',
        ]),
        this.getDynamic<number>('documents.maxZipSizeMb', undefined, 200),
      ]);
    return {
      maxSizeMb,
      maxSizeBytes: maxSizeMb * 1024 * 1024,
      maxFilesPerUpload,
      acceptedFormats,
      maxZipSizeMb,
      maxZipSizeBytes: maxZipSizeMb * 1024 * 1024,
    };
  }

  // ─────────────────────────── smart tables (Фаза 0) ────────────
  /**
   * Технические guard'ы Smart Tables (см. plans/tz/2026-05-31-smart-tables.md
   * Фаза 0, env.schema.ts → `SmartTablesSchema`). При превышении любого —
   * HTTP 400 в сервисах `tables/`.
   */
  get smartTables() {
    return {
      maxRowsPerTable: this.get('TABLE_MAX_ROWS_PER_TABLE') as number,
      maxPropsPerTable: this.get('TABLE_MAX_PROPS_PER_TABLE') as number,
      maxTablesPerOrg: this.get('TABLE_MAX_TABLES_PER_ORG') as number,
      maxCellSizeBytes: this.get('TABLE_MAX_CELL_SIZE_BYTES') as number,
      // Document-to-Table (Фаза 4) — лимиты импорта из Excel/CSV.
      importMaxFileMb: this.get('TABLE_IMPORT_MAX_FILE_MB') as number,
      importMaxFileBytes: (this.get('TABLE_IMPORT_MAX_FILE_MB') as number) * 1024 * 1024,
      importMaxRows: this.get('TABLE_IMPORT_MAX_ROWS') as number,
    } as const;
  }

  // ─────────────────────────── extraction (Фаза 0b) ─────────────
  /**
   * Параметры extraction'а группы Б (Process/Decision/Regulation/Policy/
   * Metric/Tool). См. ТЗ 0b §6.2 и решение #11 в зонтичном ТЗ.
   *
   *   - `enableTopLevel` — мастер-флаг автоизвлечения Mission/Vision/
   *     Strategy. По умолчанию false; включается только в Фазе δ.
   *   - `typedEntityMinConfidence` — нижний порог confidence, ниже которого
   *     LLM-извлечённая сущность отбрасывается (не сохраняется в БД).
   */
  get extraction() {
    return {
      enableTopLevel: this.get('EXTRACTION_ENABLE_TOP_LEVEL'),
      typedEntityMinConfidence: this.get('EXTRACTION_TYPED_ENTITY_MIN_CONFIDENCE'),
    } as const;
  }

  // ─────────────────────────── conversational (SBA α-1) ────────
  /**
   * Параметры conversational-слоя (Channels / Notifications). См.
   * plans/tz/2026-05-21-sba-alpha-1-channels-foundation.md §8.
   *
   *   - `outboundConcurrency` — concurrency BullMQ-воркера doставки.
   *   - `linkCodeTtlSec` — TTL одноразового кода привязки канала.
   *   - `quietHoursDefault` — окно тихих часов в формате `HH:mm-HH:mm`.
   *   - `rateLimitDefaultPerHour` — дефолтный лимит не-критических
   *     уведомлений на пользователя.
   *   - `emailFromDefault` — From-адрес для email-каналов; если пусто,
   *     берётся `MAIL_FROM`.
   *   - `maxDeliveryAttempts` — потолок retry'ев outbound-воркера.
   */
  get conversational() {
    const fromDefault = this.get('CONVERSATIONAL_EMAIL_FROM_DEFAULT');
    return {
      outboundConcurrency: this.get('CONVERSATIONAL_OUTBOUND_CONCURRENCY'),
      linkCodeTtlSec: this.get('CONVERSATIONAL_LINK_CODE_TTL_SEC'),
      quietHoursDefault: this.get('CONVERSATIONAL_QUIET_HOURS_DEFAULT'),
      rateLimitDefaultPerHour: this.get('CONVERSATIONAL_RATE_LIMIT_DEFAULT_PER_HOUR'),
      emailFromDefault: fromDefault.length > 0 ? fromDefault : this.get('MAIL_FROM'),
      maxDeliveryAttempts: this.get('CONVERSATIONAL_MAX_DELIVERY_ATTEMPTS'),
    } as const;
  }

  // ─────────────────────────── telegram bot (SBA β-1) ───────────
  /**
   * Глобальные параметры Telegram Bot channel-адаптера. Per-tenant
   * botToken/webhookSecret лежат в `Channel.config` (encrypted), здесь —
   * только глобальный base-URL и rate-limit (общий на все tenants —
   * Telegram считает по IP отправителя).
   */
  get telegramBot() {
    return {
      apiBase: this.get('TELEGRAM_BOT_API_BASE').replace(/\/+$/, ''),
      globalRps: this.get('TELEGRAM_BOT_GLOBAL_RPS'),
    } as const;
  }

  // ─────────────────────────── telegram proxy (2026-05-26) ──────
  /**
   * Транспорт Telegram через прокси `telegram.crossmark.ru`. См.
   * plans/tz/2026-05-26-telegram-via-crossmark-proxy.md.
   *
   *   - `enabled` — главный switch. При `true` (default в проде)
   *     `TelegramApiClient` бьёт `apiBase` прокси; `setWebhook`
   *     дёргает прокси сам (наш бэк не вызывает `setWebhook` напрямую).
   *   - `apiBase` — базовый URL для Bot API через прокси (без trailing slash).
   *   - `fileBase` — базовый URL для `/file/bot<token>/<path>`.
   *   - `token` — статический Bearer-токен админ-API прокси
   *     (`POST /api/tokens` в веб-админке прокси). Опционален: если
   *     `enabled=false` — не нужен; если `enabled=true` и пуст —
   *     `TelegramProxyAdminClient` бросит внятную ошибку при первом
   *     обращении. Пришёл на смену email/password + `/auth/login`.
   *   - `requestTimeoutMs` — timeout каждого вызова. 0 → без timeout.
   *   - `healthIntervalSec` — интервал health-check'а прокси.
   */
  get telegramProxy() {
    return {
      enabled: this.get('TELEGRAM_PROXY_ENABLED'),
      apiBase: this.get('TELEGRAM_PROXY_API_BASE').replace(/\/+$/, ''),
      fileBase: this.get('TELEGRAM_PROXY_FILE_BASE').replace(/\/+$/, ''),
      token: this.get('TELEGRAM_PROXY_TOKEN'),
      requestTimeoutMs: this.get('TELEGRAM_PROXY_REQUEST_TIMEOUT_MS'),
      healthIntervalSec: this.get('TELEGRAM_PROXY_HEALTH_INTERVAL_SEC'),
      /** audit С28 — hard-timeout для proxyAdmin.ping() в крон-tick'е. */
      pingTimeoutSec: this.get('TELEGRAM_PROXY_PING_TIMEOUT_SEC'),
    } as const;
  }

  // ─────────────────────────── max bot (SBA β-1) ─────────────────
  /**
   * Глобальные параметры MAX Bot channel-адаптера. Per-tenant
   * accessToken/webhookSecret лежат в `Channel.config` (encrypted).
   */
  get maxBot() {
    return {
      apiBase: this.get('MAX_BOT_API_BASE').replace(/\/+$/, ''),
      globalRps: this.get('MAX_BOT_GLOBAL_RPS'),
    } as const;
  }

  // ─────────────────────────── chatbox (ТЗ 2026-06-05) ───────────
  /**
   * ChatBox Public API (app.agent-lia.ru / «Call Intellect: Чаты»).
   * Per-tenant Bearer-токен лежит в `ChatboxIntegration.tokenEnc` (encrypted),
   * здесь — только базовый URL (без trailing slash).
   */
  get chatbox(): { apiBaseUrl: string } {
    return { apiBaseUrl: this.get('CHATBOX_API_BASE_URL').replace(/\/+$/, '') };
  }

  // ─────────────────────────── bot (SBA β-1 zero-button) ─────────
  /**
   * Master-flags zero-button inbound для Telegram/MAX-ботов.
   * См. plans/tz/2026-05-23-sba-beta-1-telegram-max-zero-button-ripout.md §13.
   *
   *   - voiceEnabled — приём voice-сообщений → ASR → intent classify.
   *   - documentEnabled — приём документов (PDF/DOCX/MD/TXT) → DocumentsService.
   *   - intentClassifierEnabled — LLM-классификатор intent. False → fallback
   *     на эвристики (тот же fallback срабатывает на throw LLM).
   */
  get bot() {
    return {
      voiceEnabled: this.get('BOT_VOICE_ENABLED'),
      documentEnabled: this.get('BOT_DOCUMENT_ENABLED'),
      intentClassifierEnabled: this.get('BOT_INTENT_CLASSIFIER_ENABLED'),
    } as const;
  }

  // ─────────────────────────── router (SBA α-3) ─────────────────
  /**
   * Параметры RouterService (Слой 2 → Слой 3 dispatch). См.
   * plans/tz/2026-05-21-sba-alpha-3-layer2-ontology-extension.md §5, §6.
   */
  get router() {
    return {
      dispatchConcurrency: this.get('ROUTER_DISPATCH_CONCURRENCY'),
      maxSpecialistsPerBlock: this.get('ROUTER_MAX_SPECIALISTS_PER_BLOCK'),
    } as const;
  }

  /**
   * ТЗ 2026-05-25 llm-architecture §3 — Specialists Combined (Variant Б+).
   *
   * `enabled` — мастер-флаг для нового объединённого LLM-вызова на ВСЕ блоки
   * встречи (один tool `submit_all_8_entities`). При `true` параллельно со
   * старыми специалистами 3-1..3-9 запускается `SpecialistsCombinedService`.
   * Default false (safe flag-rollout).
   */
  get specialistsCombined() {
    return {
      enabled: this.get('SPECIALISTS_COMBINED_ENABLED'),
    } as const;
  }

  // ─────────────────────────── knowledge-clone (SBA β-2) ───────
  /**
   * Параметры Specialist 3.2 (Knowledge Clone). См.
   * plans/tz/2026-05-21-sba-beta-2-specialist-3-2-knowledge-clone.md §7.
   *
   *   - `rebuildCron` — расписание `KnowledgeCloneRebuildCron`.
   *   - `lookbackMonths` — окно блоков (для каждого Person строим профиль
   *     из его блоков за N мес.).
   *   - `debounceMs` — дебаунс enqueue rebuild-job'а (сворачивает шквал
   *     диспатчей одного Person в один job).
   *   - `minBlocksForProfile` — порог: если блоков меньше — профиль не
   *     строится (нет достаточного материала, чтобы не выдавать шум).
   */
  get knowledgeClone() {
    return {
      rebuildCron: this.get('KNOWLEDGE_CLONE_REBUILD_CRON'),
      lookbackMonths: this.get('KNOWLEDGE_CLONE_LOOKBACK_MONTHS'),
      debounceMs: this.get('KNOWLEDGE_CLONE_DEBOUNCE_MS'),
      minBlocksForProfile: this.get('KNOWLEDGE_CLONE_MIN_BLOCKS_FOR_PROFILE'),
      embeddingFallbackThreshold: this.get(
        'KNOWLEDGE_CLONE_EMBEDDING_FALLBACK_THRESHOLD',
      ),
      minMatchScore: this.get('KNOWLEDGE_CLONE_MIN_MATCH_SCORE'),
    } as const;
  }

  // ─────────────────────────── curation (SBA α-4) ──────────────
  /**
   * Параметры Layer 4 (Curation) — пороги triage'а, expiry,
   * stale-detection cron. См.
   * plans/tz/2026-05-21-sba-alpha-4-layer4-curation-foundation.md §8.
   *
   *   - `autoThresholdDefault` — confidence >= → auto-canonical
   *     (если нет конфликта и тип не критический).
   *   - `deepReviewThresholdDefault` — confidence < → deep review.
   *   - `criticalTypesDefault` — массив типов, всегда уходящих в deep
   *     review (по умолчанию ['regulation', 'process', 'decision']).
   *   - `itemExpiryDays` — через сколько дней pending → expired.
   *   - `provisionalThresholdDefault` — A1: порог провизорной AI-канонизации
   *     критического типа (admin-editable, default 0.8).
   *   - `aiVerifierEnabled` — A1: включён ли AI-судья для критических типов.
   *   - `auditSampleRate` — A1: доля авто/провизорных решений в аудит-выборку.
   *   - `autotuneEnabled` — A2: автоподстройка порогов по override-rate.
   *   - `thresholdMin` — A2: нижняя граница автоподстройки порога.
   *   - `thresholdMax` — A2: верхняя граница автоподстройки порога.
   *   - `autotuneStep` — A2: шаг автоподстройки порога.
   *   - `minDecisionsForAutotune` — A2: минимум решений до автоподстройки.
   *   - `maxProvisionalOverride` — A2: порог override-rate для kill-switch.
   *   - `staleDetectorCron` — расписание CardStaleDetectorCron.
   *   - `staleMonthsThreshold` — порог `lastConfirmedAt > N мес.`.
   *   - `staleDynamicScoreThreshold` — порог упавшего `dynamicScore`.
   */
  get curation() {
    return {
      autoThresholdDefault: this.resolveSync<number>(
        'knowledge.curationAutoThresholdDefault',
        'CURATION_AUTO_THRESHOLD_DEFAULT',
        0.85,
      ),
      deepReviewThresholdDefault: this.resolveSync<number>(
        'knowledge.curationDeepReviewThresholdDefault',
        'CURATION_DEEP_REVIEW_THRESHOLD_DEFAULT',
        0.6,
      ),
      criticalTypesDefault: this.get(
        'CURATION_CRITICAL_TYPES_DEFAULT',
      ) as readonly string[],
      itemExpiryDays: this.get('CURATION_ITEM_EXPIRY_DAYS'),
      // A1/A2 «лестница доверия» — admin-editable дефолты (без ENV-fallback).
      provisionalThresholdDefault: this.resolveSync<number>(
        'knowledge.curationProvisionalThresholdDefault',
        undefined,
        0.8,
      ),
      aiVerifierEnabled: this.resolveSync<boolean>(
        'knowledge.curationAiVerifierEnabled',
        undefined,
        true,
      ),
      auditSampleRate: this.resolveSync<number>(
        'knowledge.curationAuditSampleRate',
        undefined,
        0.05,
      ),
      autotuneEnabled: this.resolveSync<boolean>(
        'knowledge.curationAutotuneEnabled',
        undefined,
        true,
      ),
      thresholdMin: this.resolveSync<number>(
        'knowledge.curationThresholdMin',
        undefined,
        0.6,
      ),
      thresholdMax: this.resolveSync<number>(
        'knowledge.curationThresholdMax',
        undefined,
        0.97,
      ),
      autotuneStep: this.resolveSync<number>(
        'knowledge.curationAutotuneStep',
        undefined,
        0.02,
      ),
      minDecisionsForAutotune: this.resolveSync<number>(
        'knowledge.curationMinDecisionsForAutotune',
        undefined,
        20,
      ),
      maxProvisionalOverride: this.resolveSync<number>(
        'knowledge.curationMaxProvisionalOverride',
        undefined,
        0.2,
      ),
      staleDetectorCron: this.get('CARD_STALE_DETECTOR_CRON'),
      staleMonthsThreshold: this.get('CARD_STALE_MONTHS_THRESHOLD'),
      staleDynamicScoreThreshold: this.get('CARD_STALE_DYNAMIC_SCORE_THRESHOLD'),
    } as const;
  }

  // ─────────────────────────── pending-actions (Action Center C2) ─
  /**
   * Крутилки «требует действия» (Action Center, Фаза C2 — напоминания).
   * Admin-editable дефолты (без ENV-fallback): cacheMap → default. Сидятся
   * в `seed-admin-settings.ts` под префиксом `pendingActions.*`.
   *
   *   - `reminderWindowStartHour` / `reminderWindowEndHour` / `reminderStepHours`
   *     — окно и шаг слот-часов Telegram-напоминаний (PendingActionsReminderCron).
   *   - `urgentAgeDays` — возраст pending-item (дни), с которого он помечается
   *     срочным (CurationPendingProvider).
   *   - `reminderLeadDays` — за сколько дней до истечения expiresAt помечать
   *     срочным (lead-окно «скоро истечёт»).
   */
  get pendingActions() {
    return {
      reminderWindowStartHour: this.resolveSync<number>(
        'pendingActions.reminderWindowStartHour',
        undefined,
        9,
      ),
      reminderWindowEndHour: this.resolveSync<number>(
        'pendingActions.reminderWindowEndHour',
        undefined,
        21,
      ),
      reminderStepHours: this.resolveSync<number>(
        'pendingActions.reminderStepHours',
        undefined,
        3,
      ),
      urgentAgeDays: this.resolveSync<number>(
        'pendingActions.urgentAgeDays',
        undefined,
        5,
      ),
      reminderLeadDays: this.resolveSync<number>(
        'pendingActions.reminderLeadDays',
        undefined,
        3,
      ),
    } as const;
  }

  // ─────────────────────────── goals (OKR) ───────────────────────────────────
  /**
   * Крутилки целей (OKR). Admin-editable (resolveSync: cacheMap → ENV → default).
   *
   *   - `themeAutolinkMinWeight` — порог веса детерминированной авто-привязки
   *     темы к цели (провенанс + co-mention). Кандидаты с weight < порога
   *     отбрасываются. Сидится `goals.themeAutolinkMinWeight` (UNIT_INTERVAL).
   *   - `themeAutolinkLlmEnabled` — вкл LLM-дозор серой зоны авто-привязки
   *     (agent-chain overhaul Фаза 4.2 step 3). Default false; ветка не
   *     реализована (golden-gated отдельной задачей) — флаг существует, no-op.
   *   - `goalTaskLinkEnabled` — вкл LLM-арбитр авто-привязки задач встречи к
   *     AI-цели (agent-chain overhaul Фаза 4.1, `goal-task-link`). Default false:
   *     новый арбитр, риск мис-атрибуции, golden нет. Non-destructive (ставит
   *     Issue.goalId только где null). При выключенном флаге линкер — no-op.
   */
  get goals() {
    return {
      themeAutolinkMinWeight: this.resolveSync<number>(
        'goals.themeAutolinkMinWeight',
        undefined,
        0.15,
      ),
      themeAutolinkLlmEnabled: this.resolveSync<boolean>(
        'goals.themeAutolinkLlmEnabled',
        undefined,
        false,
      ),
      goalTaskLinkEnabled: this.resolveSync<boolean>(
        'goals.goalTaskLinkEnabled',
        undefined,
        false,
      ),
    } as const;
  }

  // ─────────────────────────── insights (SBA β-4) ──────────────
  /**
   * Параметры Specialist 3.5 (Insights Radar). См.
   * plans/tz/2026-05-21-sba-beta-4-specialist-3-5-insights.md §7.
   *
   *   - `clusterThreshold` — cosine-порог KNN для кластеризации повторов
   *     (>= порога → обновляем existing Insight; иначе — создаём новый).
   *   - `clusterCron` — расписание `InsightClustererCron` (frequency/dynamic
   *     recalc + probe.escalation_suggested на 'spike').
   *   - `frequencyWindowDays` — окно rolling-частоты (default 30д).
   *   - `spikeRatio` — порог ratio 7d/30d-avg, выше которого ставим
   *     dynamicLabel='spike' и эмиттим probe.escalation_suggested.
   */
  get insights() {
    return {
      clusterThreshold: this.get('INSIGHT_CLUSTER_THRESHOLD'),
      clusterCron: this.get('INSIGHT_CLUSTER_CRON'),
      frequencyWindowDays: this.get('INSIGHT_FREQUENCY_WINDOW_DAYS'),
      spikeRatio: this.get('INSIGHT_SPIKE_RATIO'),
    } as const;
  }

  // ─────────────────────────── ideas (SBA β-5) ──────────────────
  /**
   * Параметры Specialist 3.6 (Ideas Collector). См.
   * plans/tz/2026-05-21-sba-beta-5-specialist-3-6-ideas-and-layer6-probe.md §8.
   *
   *   - `clusterThreshold` — cosine-порог KNN для дедупа идей.
   *   - `clustererCron` — расписание `IdeaClustererCron` (кластеризация Idea
   *     в IdeaCluster — по умолчанию каждые 4 часа).
   *   - `minSupportersForCluster` — минимум идей в кластере (порог критической
   *     массы для создания нового IdeaCluster).
   */
  get ideas() {
    return {
      clusterThreshold: this.get('IDEA_CLUSTER_THRESHOLD'),
      clustererCron: this.get('IDEA_CLUSTERER_CRON'),
      minSupportersForCluster: this.get('IDEA_MIN_SUPPORTERS_FOR_CLUSTER'),
    } as const;
  }

  // ─────────────────────────── probe (SBA β-5) ──────────────────
  /**
   * Параметры Layer 6 (Probe-Agent). См.
   * plans/tz/2026-05-21-sba-beta-5-specialist-3-6-ideas-and-layer6-probe.md §8.
   *
   *   - `dedupTtlHours` — TTL Redis-кеша дедупа по contentHash.
   *   - `rateLimitPerHour` / `rateLimitPerDay` — per-user лимиты доставки.
   *   - `expiryDays` — через сколько дней ProbeEvent → status='expired'.
   *   - `priorityRefreshCron` — расписание `ProbePriorityCron` (engagement_rate).
   *   - `quietHoursDefaultTzOffsetMin` — дефолтный TZ-сдвиг получателя.
   *   - `coldStartModeHours` — окно прогрева после первого probe.
   *
   * Agents v2 Фаза 0.1 (2026-05-30) — Probe-Response-Classify:
   *   - `responseClassifyEnabled` — master-флаг LLM-классификации ответа.
   *   - `voiceInputEnabled` — приём голосовых ответов на probe (Фаза 0.3).
   *   - `responseClassifyMinConfidence` — порог confidence для accept.
   */
  get probe() {
    return {
      dedupTtlHours: this.get('PROBE_DEDUP_TTL_HOURS'),
      rateLimitPerHour: this.get('PROBE_RATE_LIMIT_PER_USER_PER_HOUR'),
      rateLimitPerDay: this.get('PROBE_RATE_LIMIT_PER_USER_PER_DAY'),
      expiryDays: this.get('PROBE_EXPIRY_DAYS'),
      priorityRefreshCron: this.get('PROBE_PRIORITY_REFRESH_CRON'),
      quietHoursDefaultTzOffsetMin: this.get(
        'PROBE_QUIET_HOURS_DEFAULT_TZ_OFFSET_MIN',
      ),
      coldStartModeHours: this.get('PROBE_COLD_START_MODE_HOURS'),
      responseClassifyEnabled: this.get('PROBE_RESPONSE_CLASSIFY_ENABLED'),
      voiceInputEnabled: this.get('PROBE_VOICE_INPUT_ENABLED'),
      responseClassifyMinConfidence: this.get(
        'PROBE_RESPONSE_CLASSIFY_MIN_CONFIDENCE',
      ),
    } as const;
  }

  // ─────────────────────────── skill (SBA γ-1) ───────────────────
  /**
   * Параметры Specialist 3.7 (SkillProfile) + Clone API rate limits.
   *
   *   - `minObservations` — минимум наблюдений для появления trait.
   *   - `traitSimilarityThreshold` — KNN-cosine порог merge активных traits.
   *   - `lookbackMonths` — окно subject-reasoning блоков для rebuild'а.
   *   - `decayMonths` / `archiveMonths` — пороги decay/archive по lastConfirmedAt.
   *   - `recalibrateCron` / `managerDigestCron` — расписания cron'ов.
   *   - `rebuildDebounceMs` — дебаунс enqueue rebuild-job'а одного профиля.
   *   - `cloneAskPerUserPerDay` — rate limit запросов к /clones/persons/:id/ask.
   *   - `personaRebuildTraitDeltaThreshold` — сколько новых/замещённых traits
   *     за 24ч триггерит внеочередной rebuild ExecutablePersona (Фаза 5,
   *     clone reliability hardening; default 2).
   *   - `personaRebuildMaxAgeHours` — максимальный возраст активного snapshot;
   *     превышен → rebuild ставится даже без новых черт (default 48).
   */
  get skill() {
    return {
      minObservations: this.get('SKILL_MIN_OBSERVATIONS'),
      traitSimilarityThreshold: this.get('SKILL_TRAIT_SIMILARITY_THRESHOLD'),
      lookbackMonths: this.get('SKILL_LOOKBACK_MONTHS'),
      decayMonths: this.get('SKILL_DECAY_MONTHS'),
      archiveMonths: this.get('SKILL_ARCHIVE_MONTHS'),
      recalibrateCron: this.get('SKILL_RECALIBRATE_CRON'),
      managerDigestCron: this.get('SKILL_MANAGER_DIGEST_CRON'),
      rebuildDebounceMs: this.get('SKILL_REBUILD_DEBOUNCE_MS'),
      cloneAskPerUserPerDay: this.get('CLONE_ASK_PER_USER_PER_DAY'),
      // ── ТЗ 2026-05-25 clone-reliability-hardening, Фаза 1 ──
      cloneTopicSimilarityThreshold: this.get('CLONE_TOPIC_SIMILARITY_THRESHOLD'),
      cloneTopicMinBlocks: this.get('CLONE_TOPIC_MIN_BLOCKS'),
      // ── ТЗ 2026-05-25 clone-reliability-hardening, Фаза 5 ──
      personaRebuildTraitDeltaThreshold: this.get(
        'PERSONA_REBUILD_TRAIT_DELTA_THRESHOLD',
      ),
      personaRebuildMaxAgeHours: this.get('PERSONA_REBUILD_MAX_AGE_HOURS'),
      // ── ТЗ 2026-05-25 clone-reliability-hardening, Фаза 2 (смысловые блоки) ──
      conceptMatchThreshold: this.get('CLONE_CONCEPT_MATCH_THRESHOLD'),
      conceptMergeThreshold: this.get('CLONE_CONCEPT_MERGE_THRESHOLD'),
      conceptArchiveAfterMonths: this.get('CLONE_CONCEPT_ARCHIVE_AFTER_MONTHS'),
    } as const;
  }

  // ─────────────────────────── clone v2 (ТЗ 2026-05-25 §9, Фаза 7) ─
  /**
   * Параметры эволюции `clone-respond` (Фаза 7). Сейчас — один мастер-флаг.
   * Дополнительные параметры (температура factual/judgmental, порог topic-density
   * в judgmental) пока хардкодены — см. §9.9 ТЗ.
   */
  get cloneV2() {
    return {
      enabled: this.get('CLONE_V2_ENABLED'),
    } as const;
  }

  // ─────────────────────────── ai-chat-quota (ТЗ 2026-05-31) ───────
  /**
   * ТЗ 2026-05-31 ai-chat-quota — единая per-user квота Concierge+Clones.
   */
  get aiChatQuota() {
    const csv = this.get('AI_CHAT_ADMIN_ROLES') as string;
    return {
      dailyLimitAdmin: this.get('AI_CHAT_DAILY_LIMIT_ADMIN') as number,
      dailyLimitMember: this.get('AI_CHAT_DAILY_LIMIT_MEMBER') as number,
      adminRoles: csv
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean),
    } as const;
  }

  // ─────────────────────────── dialog-layer (SBA α-5 dialog-layer) ─
  /**
   * Параметры dialog-layer (Contextualizer / Cache / Summarizer). Минимально
   * добавлен здесь, чтобы dialog-layer модуль типизировался. Полноценный
   * sub-ТЗ ведут другие wave coders; на γ-1 доделки — просто маппинг.
   */
  get dialogLayer() {
    return {
      enabled: this.get('DIALOG_LAYER_ENABLED'),
      answerCacheTtlSeconds: this.get('ANSWER_CACHE_TTL_SECONDS'),
      retrievalCacheTtlSeconds: this.get('RETRIEVAL_CACHE_TTL_SECONDS'),
      contextualizerConfidenceMin: this.get('CONTEXTUALIZER_CONFIDENCE_MIN'),
      summarizerMessageThreshold: this.get('SUMMARIZER_MESSAGE_THRESHOLD'),
      multiQueryExpansionEnabled: this.get('MULTI_QUERY_EXPANSION_ENABLED'),
      queryPlanExtractionEnabled: this.get('QUERY_PLAN_EXTRACTION_ENABLED'),
      summarizerCron: this.get('DIALOG_SUMMARIZER_CRON'),
      summarizerKeepLast: this.get('DIALOG_SUMMARIZER_KEEP_LAST'),
      summarizerStalenessHours: this.get('DIALOG_SUMMARIZER_STALENESS_HOURS'),
    } as const;
  }

  // ─────────────────────────── persona (SBA γ-1) ─────────────────
  /**
   * Параметры ExecutablePersona build (weekly snapshot + role agregation
   * + SBA γ-1 доделки: гибрид-версионирование).
   */
  get persona() {
    return {
      buildCron: this.get('PERSONA_BUILD_CRON'),
      minTraits: this.get('PERSONA_MIN_TRAITS'),
      roleAggMinPersons: this.get('PERSONA_ROLE_AGG_MIN_PERSONS'),
      /// SBA γ-1 доделки.
      scheduledRebuildEnabled: this.get(
        'EXECUTABLE_PERSONA_SCHEDULED_REBUILD_ENABLED',
      ),
      thresholdTraitsCount: this.get('EXECUTABLE_PERSONA_THRESHOLD_TRAITS_COUNT'),
      minRebuildIntervalMinutes: this.get(
        'EXECUTABLE_PERSONA_MIN_REBUILD_INTERVAL_MINUTES',
      ),
    } as const;
  }

  // ─────────────────────────── idle ──────────────────────────────
  get idle() {
    return {
      timeoutMinutes: this.resolveSync<number>(
        'idle.timeoutMinutes',
        'IDLE_MEETING_TIMEOUT_MINUTES',
        15,
      ),
      cron: this.resolveSync<string>(
        'idle.cron',
        'IDLE_MEETING_CRON',
        '*/1 * * * *',
      ),
    } as const;
  }

  // ─────────────────────── recording reliability ─────────────────
  /**
   * Надёжность записи (ТЗ 2026-06-03 meeting-recording-reliability):
   *   - trackReconcileEnabled — периодическая сверка per-track дорожек (P0, ON).
   *   - faststartEnabled      — faststart-постобработка composite MP4 (P1, ON).
   *   - faststartMinBytes     — порог: ниже него composite не ремуксится (мелкий
   *     файл и так играет мгновенно). Дефолт 50 МиБ.
   *   - compositeReconcileEnabled — pull-фоллбэк на потерянный composite
   *     egress-вебхук (cron `composite-egress-reconcile`, ТЗ 2026-06-06, ON).
   */
  get recording() {
    return {
      trackReconcileEnabled: this.resolveSync<boolean>(
        'recording.trackReconcileEnabled',
        'RECORDING_TRACK_RECONCILE_ENABLED',
        true,
      ),
      faststartEnabled: this.resolveSync<boolean>(
        'recording.faststartEnabled',
        'RECORDING_FASTSTART_ENABLED',
        true,
      ),
      faststartMinBytes: this.resolveSync<number>(
        'recording.faststartMinBytes',
        'RECORDING_FASTSTART_MIN_BYTES',
        52_428_800,
      ),
      compositeReconcileEnabled: this.resolveSync<boolean>(
        'recording.compositeReconcileEnabled',
        'RECORDING_COMPOSITE_RECONCILE_ENABLED',
        true,
      ),
      /**
       * Ручная загрузка встреч (ТЗ-5 Ф6) — аварийный рубильник `POST
       * /meetings/upload`. AdminSetting `meeting_upload.enabled` →
       * ENV `MEETING_UPLOAD_ENABLED` → default true (Ship-On, ON).
       * Сервис читает тот же ключ через async `getDynamic` (см.
       * MeetingUploadsService.assertUploadEnabled).
       */
      meetingUploadEnabled: this.resolveSync<boolean>(
        'meeting_upload.enabled',
        'MEETING_UPLOAD_ENABLED',
        true,
      ),
    } as const;
  }

  // ─────────────────────────── quotas ────────────────────────────
  get quotas() {
    return {
      maxParticipantsPerMeeting: this.resolveSync<number>(
        'limits.maxParticipantsPerMeeting',
        'MAX_PARTICIPANTS_PER_MEETING',
        10,
      ),
      maxMeetingDurationHours: this.resolveSync<number>(
        'limits.maxMeetingDurationHours',
        'MAX_MEETING_DURATION_HOURS',
        8,
      ),
    } as const;
  }

  // ─────────────────────────── process-template (SBA α-7 wave 2) ────
  /**
   * Параметры Specialist 3.1 ProcessTemplate detector + completeness cron.
   * См. plans/tz/2026-05-23-sba-alpha-7-wave2-process-template-services.md §13.
   *
   * NB: значения читаются через `raw.get` без typed inference, чтобы избежать
   * каскадного TS2589 на агрегированной Env-схеме (см. issue в комментариях
   * других accessor'ов TypedConfigService).
   */
  get processTemplate() {
    return {
      detectorBatchSize: Number(this.get('PROCESS_DETECTOR_BATCH_SIZE') ?? 10),
      detectorBatchTimeoutSeconds: Number(
        this.get('PROCESS_DETECTOR_BATCH_TIMEOUT_SECONDS') ?? 300,
      ),
      completenessCron: String(
        this.get('PROCESS_TEMPLATE_COMPLETENESS_CRON') ?? '0 3 * * *',
      ),
      dedupeThreshold: Number(
        this.get('PROCESS_TEMPLATE_DEDUPE_THRESHOLD') ?? 0.85,
      ),
      /// SBA γ-3 — Cross-Functional Process detector + friction aggregator.
      crossFunctionalDetectorEnabled:
        this.get('CROSS_FUNCTIONAL_DETECTOR_ENABLED') !== false,
      crossFunctionalScoreThreshold: Number(
        this.get('CROSS_FUNCTIONAL_SCORE_THRESHOLD') ?? 0.5,
      ),
    } as const;
  }

  // ─────────────────────────── admin ─────────────────────────────
  get admin() {
    return {
      bootstrapEmail: this.get('ADMIN_BOOTSTRAP_EMAIL'),
      sessionTtlSeconds: this.get('ADMIN_SESSION_TTL_SECONDS'),
    } as const;
  }

  // ─────────────────────────── company-foundation (SBA α-9 wave 3) ──
  /**
   * Параметры Company Foundation (CompanyProfile / FunctionalDomain /
   * MaturityScorer). См. plans/tz/2026-05-23-sba-alpha-9-wave3-company-foundation-services.md §13.
   */
  get companyFoundation() {
    return {
      domainExpanderEnabled: this.get('DOMAIN_EXPANDER_ENABLED'),
      domainExpanderMinClusterSize: this.get('DOMAIN_EXPANDER_MIN_CLUSTER_SIZE'),
      domainExpanderMaxNewPerRun: this.get('DOMAIN_EXPANDER_MAX_NEW_PER_RUN'),
      maturityScorerEnabled: this.get('MATURITY_SCORER_ENABLED'),
    } as const;
  }

  // ─────────────────────────── experiments (SBA β-6) ─────────────────
  /**
   * Параметры Experiment Tracker (Specialist 3.9). См.
   * plans/tz/2026-05-23-sba-beta-6-experiment-tracker.md §13.
   *
   *   - `autoStatusTransitionEnabled` — мастер-флаг автоперевода статусов
   *     в `experiment-status-resolver.cron`. При false cron только считает
   *     метрики и эмитит probe'ы, без UPDATE статуса.
   *   - `runningProbeThresholdDays` — порог дней без результата для probe
   *     `experiment.running_too_long`.
   */
  get experiments() {
    return {
      autoStatusTransitionEnabled: this.get(
        'EXPERIMENT_AUTO_STATUS_TRANSITION_ENABLED',
      ),
      runningProbeThresholdDays: this.get(
        'EXPERIMENT_RUNNING_PROBE_THRESHOLD_DAYS',
      ),
    } as const;
  }

  // ─────────────────────────── brand-voice (SBA β-7) ─────────────────
  /**
   * Параметры Brand Voice Curator (Specialist 3.10). См.
   * plans/tz/2026-05-23-sba-beta-7-brand-voice-curator.md §13.
   *
   *   - `extractorEnabled` — мастер-флаг daily-cron'а извлечения профиля.
   *     При false cron работает в no-op режиме (для прода первой недели).
   *   - `minCorpusSize` — минимум документов с useCases includes 'brand_corpus',
   *     ниже которого экстрактор пропускает Org (anti-noise threshold).
   */
  get brandVoice() {
    return {
      extractorEnabled: this.get('BRAND_VOICE_EXTRACTOR_ENABLED'),
      minCorpusSize: this.get('BRAND_VOICE_MIN_CORPUS_SIZE'),
    } as const;
  }

  // ─────────────────────────── role-map (SBA α-8 wave 4) ─────────────
  /**
   * Параметры Role Map builder + completeness cron. См.
   * plans/tz/2026-05-23-sba-alpha-8-wave4-role-map-worker-rest-ui.md §13.
   *
   *   - `builderEnabled` — мастер-флаг RoleMapBuilderWorker. При false воркер
   *     не подписывается на core.specialist-routing (no-op).
   *   - `batchTimeoutSeconds` — окно дебаунса батча per role (default 300 =
   *     5 мин); если за окно блоков накопилось — flush.
   */
  get roleMap() {
    return {
      builderEnabled: this.get('ROLE_MAP_BUILDER_ENABLED'),
      batchTimeoutSeconds: Number(
        this.get('ROLE_MAP_BATCH_TIMEOUT_SECONDS') ?? 300,
      ),
    } as const;
  }

  // ─────────────────────────── betaOps (SBA β-8) ─────────────────────
  /**
   * SBA β-8 — DailyCheckIn + OperationsDashboard (Personal Relation + COO).
   * См. plans/tz/2026-05-23-sba-beta-8-personal-relation-coo-checkin.md §13.
   *
   *   - `dailyCheckInEnabled` — мастер-флаг cron'а; false → no-op.
   *   - `morningLocalHour` / `eveningLocalHour` — час локальной TZ Person'а
   *     для morning / evening prompt (default 9 / 18).
   *   - `operationsDashboardCacheTtlSeconds` — TTL Redis-кэша COO-агрегата
   *     `/api/v1/dashboard/operations/overview` (default 300 = 5 мин).
   */
  get betaOps() {
    return {
      dailyCheckInEnabled: this.get('DAILY_CHECKIN_ENABLED'),
      morningLocalHour: Number(this.get('DAILY_CHECKIN_MORNING_LOCAL_HOUR') ?? 9),
      eveningLocalHour: Number(this.get('DAILY_CHECKIN_EVENING_LOCAL_HOUR') ?? 18),
      operationsDashboardCacheTtlSeconds: Number(
        this.get('OPERATIONS_DASHBOARD_CACHE_TTL_SECONDS') ?? 300,
      ),
      // SBA β-8.1 — добивка панели операционного директора.
      sentimentEnabled: this.get('COO_SENTIMENT_ENABLED') !== false,
      weeklyDigestEnabled: this.get('COO_WEEKLY_DIGEST_ENABLED') !== false,
      weeklyDigestLocalHour: Number(this.get('COO_WEEKLY_DIGEST_LOCAL_HOUR') ?? 8),
      weeklyDigestLocalDay: Number(this.get('COO_WEEKLY_DIGEST_LOCAL_DAY') ?? 1),
      // SBA β-8.3 — ежедневный отчёт COO (статические fallback'и; в cron
      // используется `TypedConfigService.getDynamic` поверх AdminSetting).
      dailyDigestEnabled: this.get('COO_DAILY_DIGEST_ENABLED') !== false,
      dailyDigestDeliverToTelegram:
        this.get('COO_DAILY_DIGEST_DELIVER_TO_TELEGRAM') === true,
      dailyDigestHourUtc: Number(this.get('COO_DAILY_DIGEST_HOUR_UTC') ?? 22),
      // SBA β-8.2 — «Хранитель обещаний».
      commitmentFollowupEnabled:
        this.get('COMMITMENT_FOLLOWUP_ENABLED') !== false,
      commitmentFollowupLocalHour: Number(
        this.get('COMMITMENT_FOLLOWUP_LOCAL_HOUR') ?? 9,
      ),
      commitmentFallbackDueWorkdays: Number(
        this.get('COMMITMENT_FALLBACK_DUE_WORKDAYS') ?? 5,
      ),
      commitmentEscalationDays: Number(
        this.get('COMMITMENT_ESCALATION_DAYS') ?? 3,
      ),
      commitmentMaxRetries: Number(this.get('COMMITMENT_MAX_RETRIES') ?? 2),
    } as const;
  }

  // ─────────────────────────── invites (β-9, 2026-05-25) ──────────────
  /**
   * β-9 — Глобальный Telegram-бот + GitHub-style приглашения. См.
   * plans/tz/2026-05-25-telegram-bot-global-and-invites.md §13.
   *
   *   - `botUsername` — имя глобального бота без `@`, для построения
   *     deep-link'а `https://t.me/<botUsername>?start=<code>`.
   *   - `ttlDays` — срок жизни приглашения (default 14).
   *   - `reminderDays` — на какой день после создания приглашения отправлять
   *     напоминание сотруднику (default 7).
   *   - `magicLinkTtlMinutes` — TTL одноразовой ссылки входа без пароля
   *     (default 15).
   *   - `magicLinkRateLimitPerHour` — лимит запросов magic-link на одну
   *     электронную почту в час (default 5).
   *   - `inactiveBindingDays` — через сколько дней привязки с заблокированным
   *     ботом сотрудник помечается `inactive` (default 30).
   */
  get invites() {
    return {
      botUsername: String(this.get('KORA_BOT_USERNAME') ?? 'kora_bot').replace(
        /^@/,
        '',
      ),
      ttlDays: Number(this.get('INVITE_TTL_DAYS') ?? 14),
      reminderDays: Number(this.get('INVITE_REMINDER_DAYS') ?? 7),
      magicLinkTtlMinutes: Number(this.get('MAGIC_LINK_TTL_MINUTES') ?? 15),
      magicLinkRateLimitPerHour: Number(
        this.get('MAGIC_LINK_RATE_LIMIT_PER_HOUR') ?? 5,
      ),
      inactiveBindingDays: Number(this.get('INACTIVE_BINDING_DAYS') ?? 30),
    } as const;
  }

  // ─────────────────────────── proactive (SBA δ-2) ───────────────────
  /**
   * SBA δ-2 — ProactiveWatcher. См.
   * plans/tz/2026-05-23-sba-delta-2-proactive-watcher.md §13.
   *
   *   - `enabled` — мастер-флаг cron'а. False → no-op (cron всё равно тикает,
   *     но сразу выходит — позволяет включать без рестарта).
   *   - `antiSpamTtlHours` — TTL Redis-key `proactive:dedup:{tenantId}:{userId}:{dateLocal}`
   *     (default 24h). После TTL — ключ исчезает, anti-spam-капля «сбрасывается».
   *   - `rules.*` — per-rule тумблеры (admin может отключать отдельные правила).
   *
   * NB: ENV-ключи живут в `BetaOpsSchema` (см. env.schema.ts), чтобы не
   * удлинять `.merge` цепочку EnvSchema (TS2589).
   */
  get proactive() {
    return {
      enabled: this.get('PROACTIVE_WATCHER_ENABLED') !== false,
      antiSpamTtlHours: Number(
        this.get('PROACTIVE_WATCHER_ANTI_SPAM_TTL_HOURS') ?? 24,
      ),
      rules: {
        decisionNoOwner:
          this.get('PROACTIVE_RULE_DECISION_NO_OWNER_ENABLED') !== false,
        insightNoMitigation:
          this.get('PROACTIVE_RULE_INSIGHT_NO_MITIGATION_ENABLED') !== false,
        experimentRunningTooLong:
          this.get('PROACTIVE_RULE_EXPERIMENT_RUNNING_TOO_LONG_ENABLED') !==
          false,
        processStaleReview:
          this.get('PROACTIVE_RULE_PROCESS_STALE_REVIEW_ENABLED') !== false,
        roleLowCompleteness:
          this.get('PROACTIVE_RULE_ROLE_LOW_COMPLETENESS_ENABLED') !== false,
        departmentNoDomain:
          this.get('PROACTIVE_RULE_DEPARTMENT_NO_DOMAIN_ENABLED') !== false,
        insightsSiloedInDomain:
          this.get('PROACTIVE_RULE_INSIGHTS_SILOED_IN_DOMAIN_ENABLED') !==
          false,
        planItemOverdue:
          this.get('PROACTIVE_RULE_PLAN_ITEM_OVERDUE_ENABLED') !== false,
      },
    } as const;
  }

  // ─────────────────────────── voice (SBA δ-3) ───────────────────────
  /**
   * Параметры VoiceChannelAdapter (TTS provider/voice + WebSocket master
   * flag). См. plans/tz/2026-05-23-sba-delta-3-voice-channel-adapter.md §13.
   *
   *   - `ttsProvider` — `openai` (default) | `yandex` (опц., MVP не активен).
   *   - `ttsVoice` — дефолтный голос для OpenAI TTS (per-call можно override).
   *   - `wsEnabled` — мастер-флаг WS endpoint'а concierge voice. На δ-3
   *     зарезервирован под γ-2 (handler ещё не реализован).
   */
  get voice() {
    return {
      ttsProvider: String(this.get('TTS_PROVIDER') ?? 'openai') as
        | 'openai'
        | 'yandex',
      ttsVoice: String(this.get('TTS_VOICE') ?? 'alloy'),
      wsEnabled: this.get('VOICE_WS_ENABLED') !== false,
    } as const;
  }

  // ─────────────────────────── concierge (SBA γ-2) ────────────────────
  /**
   * Параметры Concierge Agent (sквозной UX-слой через tool-use). См.
   * plans/tz/2026-05-23-sba-gamma-2-concierge-agent.md §13.
   *
   *   - `enabled` — мастер-флаг модуля. False → REST возвращает 503.
   *   - `dailyMessagesLimit` / `monthlyMessagesLimit` — defaults для
   *     `OrgConciergeQuota` при создании записи (per-Org override через
   *     админку). Анти-abuse.
   *   - `sseHeartbeatSeconds` — интервал heartbeat-комментариев в SSE
   *     stream, чтобы прокси/CDN не закрывали соединение по idle.
   *   - `dialogLayerEnabled` — фича-флаг ТЗ 2026-05-27 (Concierge → dialog-layer).
   *     При `true` и инджекте `DialogService` `ConciergeService.process()`
   *     перед основным tool-loop'ом вызывает `DialogService.process()`
   *     (контекстуализация + classify + multi-query + answer-cache).
   *     Default — `false` (в отличие от мастер-флага `CONCIERGE_ENABLED`).
   *   - `preRetrievalTopK` — ТЗ 2026-05-27 Фаза 3: максимум записей графа,
   *     которые подмешиваются в системный промпт после параллельного
   *     `search_knowledge` по `dialogResult.queries[]`. Default 12. ENV
   *     `CONCIERGE_PRE_RETRIEVAL_TOP_K`. Cumulative по нескольким queries
   *     после дедупа по `id`.
   *   - `preRetrievalTimeoutMs` — ТЗ 2026-05-27 Фаза 3: per-query тайм-аут
   *     на pre-retrieval. По истечении конкретный поиск skip-ается,
   *     остальные продолжают. Default 3000ms. ENV `CONCIERGE_PRE_RETRIEVAL_TIMEOUT_MS`.
   *   - `prmShadowEnabled` — Agents v2 Фаза B2 (2026-05-30): включает
   *     shadow-режим PRM step-scorer. При `true` ConciergeService после
   *     каждого LLM tool_call дополнительно генерирует top-K кандидатов,
   *     оценивает их через `concierge-step-prm` и пишет `ConciergeStepScore`.
   *     Concierge всё равно выполняет ВЫБОР LLM (не PRM). Default `false`.
   *     ENV `CONCIERGE_PRM_SHADOW_ENABLED`.
   *   - `prmTopK` — Agents v2 Фаза B2: сколько кандидатов оценивает PRM
   *     (включая LLM-выбор). Default 3. ENV `CONCIERGE_PRM_TOP_K`.
   *   - `prmEnabled` — Agents v2 Фаза C/D (зарезервирован): при `true`
   *     ConciergeService применяет PRM-выбор вместо LLM-выбора. В Фазе B
   *     всегда `false`. ENV `CONCIERGE_PRM_ENABLED`.
   *   - `prmShadowSampleRate` — Agents v2 Фаза B2: доля tool_call'ов,
   *     для которых запускается PRM shadow (0..1). Default 1.0 (все).
   *     Cost-защита: при дорогих доп. вызовах можно понизить до 0.1.
   *     ENV `CONCIERGE_PRM_SHADOW_SAMPLE_RATE`.
   */
  get concierge() {
    // NB: ключи CONCIERGE_* читаем из process.env, а не через ConfigService.
    // Они НЕ добавлены в EnvSchema, чтобы не углублять .merge цепочку и не
    // триггерить TS2589. Парсинг — runtime fallback на defaults.
    const enabledRaw = process.env.CONCIERGE_ENABLED;
    const enabled =
      enabledRaw === undefined ||
      enabledRaw === '' ||
      ['true', '1', 'yes', 'on'].includes(enabledRaw.trim().toLowerCase());
    const parseInt = (raw: string | undefined, fallback: number): number => {
      if (!raw) return fallback;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
    };
    const dialogLayerRaw = process.env.CONCIERGE_DIALOG_LAYER_ENABLED;
    const dialogLayerEnabled =
      dialogLayerRaw === undefined ||
      dialogLayerRaw === '' ||
      ['true', '1', 'yes', 'on'].includes(dialogLayerRaw.trim().toLowerCase());
    // Agents v2 Фаза B2 (2026-05-30) — PRM step-scorer (shadow).
    const parseBoolDefaultFalse = (raw: string | undefined): boolean => {
      if (raw === undefined || raw === '') return false;
      return ['true', '1', 'yes', 'on'].includes(raw.trim().toLowerCase());
    };
    const parseFloatPositive = (
      raw: string | undefined,
      fallback: number,
    ): number => {
      if (!raw) return fallback;
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? n : fallback;
    };
    const prmShadowEnabled = parseBoolDefaultFalse(
      process.env.CONCIERGE_PRM_SHADOW_ENABLED,
    );
    const prmEnabled = parseBoolDefaultFalse(
      process.env.CONCIERGE_PRM_ENABLED,
    );
    const prmTopK = parseInt(process.env.CONCIERGE_PRM_TOP_K, 3);
    const prmShadowSampleRateRaw = parseFloatPositive(
      process.env.CONCIERGE_PRM_SHADOW_SAMPLE_RATE,
      1.0,
    );
    const prmShadowSampleRate = Math.min(Math.max(prmShadowSampleRateRaw, 0), 1);
    return {
      enabled,
      dailyMessagesLimit: parseInt(process.env.CONCIERGE_DAILY_MESSAGES_LIMIT, 100),
      monthlyMessagesLimit: parseInt(
        process.env.CONCIERGE_MONTHLY_MESSAGES_LIMIT,
        3000,
      ),
      sseHeartbeatSeconds: parseInt(
        process.env.CONCIERGE_SSE_HEARTBEAT_SECONDS,
        15,
      ),
      dialogLayerEnabled,
      preRetrievalTopK: parseInt(process.env.CONCIERGE_PRE_RETRIEVAL_TOP_K, 12),
      preRetrievalTimeoutMs: parseInt(
        process.env.CONCIERGE_PRE_RETRIEVAL_TIMEOUT_MS,
        3000,
      ),
      prmShadowEnabled,
      prmEnabled,
      prmTopK,
      prmShadowSampleRate,
    } as const;
  }

  // ─────────────────────────── budget (SBA α-10 wave 3) ───────────────
  /**
   * Параметры Admin LLM + Unit Economics: budget alerts, currency sync,
   * provider smoke-tests + feature-flag для LlmProtocolAdapterRegistry.
   * См. plans/tz/2026-05-23-sba-alpha-10-wave3-admin-llm-economics.md §13.
   *
   *   - `alertEnabled` — мастер-флаг BudgetAlertCron.
   *   - `alertThresholdPercents` — массив порогов % (parsed из CSV "80,100").
   *   - `currencyRateApiUrl` — ЦБ РФ или эквивалент (fallback rate ниже).
   *   - `currencyFallbackUsdRub` — если API недоступен, считаем по этому курсу.
   *   - `providerSmokeTestEnabled` — мастер-флаг ProviderSmokeTestCron.
   *   - `providerSmokeTestIntervalMinutes` — частота smoke-теста.
   *   - `providerSmokeTestFailThreshold` — сколько подряд провалов до alert.
   *   - `useProtocolAdapterRegistry` — переключение `switch(provider)` →
   *     LlmProtocolAdapterRegistry. Default false (production safety).
   */
  get budget() {
    const rawThresholds = String(
      this.get('BUDGET_ALERT_THRESHOLD_PERCENTS') ?? '80,100',
    );
    const thresholds = rawThresholds
      .split(',')
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0 && n <= 1000)
      .sort((a, b) => a - b);
    return {
      alertEnabled: this.get('BUDGET_ALERT_ENABLED') !== false,
      alertThresholdPercents:
        thresholds.length > 0 ? thresholds : [80, 100],
      currencyRateApiUrl: String(
        this.get('CURRENCY_RATE_API_URL') ??
          'https://www.cbr-xml-daily.ru/daily_json.js',
      ),
      currencyFallbackUsdRub: Number(
        this.get('CURRENCY_RATE_FALLBACK_USD_RUB') ?? 90,
      ),
      providerSmokeTestEnabled:
        this.get('PROVIDER_SMOKE_TEST_ENABLED') !== false,
      providerSmokeTestIntervalMinutes: Number(
        this.get('PROVIDER_SMOKE_TEST_INTERVAL_MINUTES') ?? 30,
      ),
      providerSmokeTestFailThreshold: Number(
        this.get('PROVIDER_SMOKE_TEST_FAIL_THRESHOLD') ?? 3,
      ),
      useProtocolAdapterRegistry:
        this.get('USE_PROTOCOL_ADAPTER_REGISTRY') === true,
    } as const;
  }

  // ─────────────────────────── tracker (Sprint 1) ────────────────────
  /**
   * Параметры tracker-модуля (Issues / Intake / Webhooks Out / событий в
   * knowledge-core). См. plans/tz/2026-05-23-tracker-phase-1-models-api.md
   * §"Webhooks Out" и §"Метрики Prometheus".
   *
   *   - `webhookHmacPrefix` — префикс secret'а webhook'а (для ротации).
   *   - `ingestQueue` — имя BullMQ-очереди ingest'а tracker → knowledge-core.
   *   - `idempotencyKeyTtlSeconds` — TTL Idempotency-Key в Redis.
   *   - `webhookMaxRetries` — потолок ретраев доставки webhook'а.
   *   - `webhookRetryBackoffInitialMs` — начальная задержка retry, ms.
   */
  get tracker() {
    return {
      webhookHmacPrefix: this.get('WEBHOOK_HMAC_PREFIX'),
      ingestQueue: this.get('TRACKER_INGEST_QUEUE'),
      idempotencyKeyTtlSeconds: this.get('IDEMPOTENCY_KEY_TTL_SECONDS'),
      webhookMaxRetries: this.get('TRACKER_WEBHOOK_MAX_RETRIES'),
      webhookRetryBackoffInitialMs: this.get(
        'TRACKER_WEBHOOK_RETRY_BACKOFF_INITIAL_MS',
      ),
      // Ф3 agent-chain-overhaul (2026-06-07): порог авто-создания Issue из
      // триажа встречи — admin-editable крутилка (resolveSync: cacheMap →
      // default). Дефолт 0.75 под живую речь (реальные confidence LLM 35–75%);
      // раньше hardcoded 0.92 → 100% задач застревали в ручном триаже.
      // Жёсткие гейты (source=meeting + assignee + project) остаются страховкой.
      autoAcceptConfidenceThreshold: this.resolveSync<number>(
        'tracker.autoAcceptConfidenceThreshold',
        undefined,
        0.75,
      ),
    } as const;
  }

  // ─────────────────── dataclass policy (W4.1 knowledge-core temporal) ──
  /**
   * Параметры `DataClassPolicyService` — единого источника правды по
   * вычислению `DataClass` для проекций knowledge-core.
   *
   *   - `enforcement` ∈ off | shadow | enforce. На W4.1 — `shadow` (default).
   *     На W4.2 — переключим в `enforce` после ≥1 недели без расхождений.
   *   - `version` — строка-маркер версии правил v1, пишется в
   *     `DataClassAudit.policyVersion`. Меняется только деплоем кода.
   *
   * См. plans/tz/2026-05-25-knowledge-core-temporal-and-graph-quality.md §W4.1.
   */
  get dataClassPolicy() {
    const mode = this.get('DATACLASS_POLICY_ENFORCEMENT') as
      | 'off'
      | 'shadow'
      | 'enforce'
      | undefined;
    return {
      enforcement: mode ?? 'shadow',
      version: String(this.get('DATACLASS_POLICY_VERSION') ?? 'v1'),
      // W4.2 (2026-05-25) — фейлить persist без audit при enforce.
      auditRequired: Boolean(this.get('DATACLASS_AUDIT_REQUIRED') ?? true),
      // W4.3 (2026-05-25) — kill-switch outbound gating каналов. Если false —
      // `DataClassPolicyService.canEmit` всегда возвращает `allowed=true`.
      outboundGatingEnabled: Boolean(
        this.get('DATACLASS_OUTBOUND_GATING_ENABLED') ?? true,
      ),
    } as const;
  }

  // ─────────────────── Ф2 knowledge-access groups ──────────────────────
  /**
   * Режим гейта доступа к знаниям (группы). off (default) — фильтр не
   * применяется, поведение текущее. shadow — метрики расхождения. enforce —
   * фильтр во всех поверхностях retrieval. См. ТЗ
   * plans/tz/2026-06-06-knowledge-access-groups-and-provenance.md.
   */
  get knowledgeAccess() {
    const mode = this.get('KNOWLEDGE_ACCESS_ENFORCEMENT') as
      | 'off'
      | 'shadow'
      | 'enforce'
      | undefined;
    return { enforcement: mode ?? 'off' } as const;
  }

  // ─────────────────── W2.2 calibrated confidence (KC-Temporal) ───────
  /**
   * W2.2 — параметры Platt scaling калибровки confidence.
   *
   *   - `enabled` — если false, `ConfidenceCalibrationService.calibrate(raw)`
   *     возвращает raw (identity). Cron не пишет AdminSetting.
   *   - `cron` — расписание еженедельной пересборки `{ a, b }` per taskType.
   *
   * См. plans/tz/2026-05-25-knowledge-core-temporal-and-graph-quality.md §W2.2.
   */
  get confidenceCalibration() {
    return {
      enabled: Boolean(this.get('CONFIDENCE_CALIBRATION_ENABLED') ?? false),
      cron: String(this.get('CONFIDENCE_CALIBRATION_CRON') ?? '0 4 * * 0'),
    } as const;
  }

  // ─────────────────── W2.4 темпоральный probe-trigger ─────────────────
  /**
   * W2.4 — параметры `temporal.fact_stale_contradiction` probe-trigger'а.
   *
   *   - `cron` — когда запускать проверку (default — понедельник 07:00 UTC).
   *   - `limitPerOrg` — лимит probe на Org за один проход (default 50).
   *   - `escalateAfterWeeks` — через сколько недель без ответа эскалировать
   *     owner'у (default 2).
   *
   * См. plans/tz/2026-05-25-knowledge-core-temporal-and-graph-quality.md §W2.4.
   */
  get temporalProbe() {
    return {
      cron: String(this.get('TEMPORAL_PROBE_CRON') ?? '0 7 * * 1'),
      limitPerOrg: Number(this.get('TEMPORAL_PROBE_LIMIT_PER_ORG') ?? 50),
      escalateAfterWeeks: Number(
        this.get('TEMPORAL_PROBE_ESCALATE_AFTER_WEEKS') ?? 2,
      ),
    } as const;
  }

  // ─────────────────── G.2 Markov-матрица переходов signalType ────────
  /**
   * G.2 — параметры daily cron для расчёта матрицы переходов signalType.
   *
   *   - `cron` — daily (default 02:00 UTC).
   *   - `driftSigmaThreshold` — σ-порог для алёрта о дрейфе (3.0 ≈ 99.7%).
   *
   * См. plans/tz/2026-05-25-knowledge-core-temporal-and-graph-quality.md §G.2.
   */
  get signalTypeStats() {
    return {
      cron: String(this.get('SIGNAL_TYPE_STATS_CRON') ?? '0 2 * * *'),
      driftSigmaThreshold: Number(
        this.get('SIGNAL_TYPE_DRIFT_SIGMA_THRESHOLD') ?? 3.0,
      ),
    } as const;
  }

  // ─────────────────────────── push (Wave 2 — web-push) ──────────────
  /**
   * Web Push (VAPID) — параметры отправки браузерных уведомлений.
   * Если хотя бы один из VAPID-ключей пустой, отправка отключается
   * (WebPushSender уходит в no-op + warn); persistence (создание подписок)
   * продолжает работать. См. plans/tz перед стартом Wave 2 backend-web-push.
   */
  get push() {
    const publicKey = String(this.get('VAPID_PUBLIC_KEY') ?? '').trim();
    const privateKey = String(this.get('VAPID_PRIVATE_KEY') ?? '').trim();
    return {
      vapidPublicKey: publicKey.length > 0 ? publicKey : undefined,
      vapidPrivateKey: privateKey.length > 0 ? privateKey : undefined,
      vapidSubject: String(this.get('VAPID_SUBJECT') ?? 'mailto:noreply@kora.app'),
      maxFailures: Number(this.get('PUSH_MAX_FAILURES') ?? 5),
      /** true если оба ключа заданы и можно физически отправлять push'и. */
      isSendEnabled: publicKey.length > 0 && privateKey.length > 0,
    } as const;
  }

  // ─────────────────────────── billing (Tochka + DaData + InnLookup) ──
  /**
   * Биллинг + интеграция с Точкой + DaData + ИНН-лукап.
   * См. ТЗ plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §5.
   *
   *   - `provider` — выбор `BillingProviderPort` через фабрику в BillingModule.
   *   - `features.*` — feature-flags для постепенного включения сценариев.
   *   - `legalEntity` — реквизиты Z, попадают в шапку PDF-счёта.
   *   - `tochka` — режим/url/OAuth/webhook параметры Точки.
   *   - `dadata` / `innLookup` — параметры lookup'а по ИНН.
   */
  get billing() {
    const provider = String(this.get('BILLING_PROVIDER') ?? 'manual') as
      | 'tochka'
      | 'manual';
    const tochkaMode = String(this.get('TOCHKA_MODE') ?? 'sandbox') as
      | 'sandbox'
      | 'production';
    const customDadataKey = String(this.get('DADATA_API_KEY') ?? '').trim();

    return {
      provider,
      features: {
        tochka: this.get('FEATURE_BILLING_TOCHKA') === true,
        cardRecurring: this.get('FEATURE_BILLING_CARD_RECURRING') === true,
        bankInvoice: this.get('FEATURE_BILLING_BANK_INVOICE') === true,
      },
      publicApiUrl: this.get('BILLING_PUBLIC_API_URL') as string | undefined,
      successRedirectUrl: this.get('BILLING_SUCCESS_REDIRECT_URL') as
        | string
        | undefined,
      failRedirectUrl: this.get('BILLING_FAIL_REDIRECT_URL') as
        | string
        | undefined,
      legalEntity: {
        name: this.get('BILLING_LEGAL_ENTITY_NAME') as string | undefined,
        inn: this.get('BILLING_LEGAL_ENTITY_INN') as string | undefined,
        kpp: this.get('BILLING_LEGAL_ENTITY_KPP') as string | undefined,
        address: this.get('BILLING_LEGAL_ENTITY_ADDRESS') as string | undefined,
        bik: this.get('BILLING_LEGAL_ENTITY_BIK') as string | undefined,
        account: this.get('BILLING_LEGAL_ENTITY_ACCOUNT') as string | undefined,
      },
      tochka: {
        mode: tochkaMode,
        isProduction: tochkaMode === 'production',
        isSandbox: tochkaMode === 'sandbox',
        apiVersion: String(this.get('TOCHKA_API_VERSION') ?? 'v1.0'),
        baseUrl:
          (this.get('TOCHKA_API_BASE_URL') as string | undefined) ??
          (tochkaMode === 'production'
            ? 'https://enter.tochka.com/uapi/'
            : 'https://enter.tochka.com/sandbox/v2/'),
        customerCode: this.get('TOCHKA_CUSTOMER_CODE') as string | undefined,
        accountId: this.get('TOCHKA_ACCOUNT_ID') as string | undefined,
        merchantId: this.get('TOCHKA_MERCHANT_ID') as string | undefined,
        clientId: this.get('TOCHKA_CLIENT_ID') as string | undefined,
        clientSecret: this.get('TOCHKA_CLIENT_SECRET') as string | undefined,
        redirectUri: this.get('TOCHKA_REDIRECT_URI') as string | undefined,
        jwtToken: this.get('TOCHKA_JWT_TOKEN') as string | undefined,
        oauthScopes: String(this.get('TOCHKA_OAUTH_SCOPES') ?? '')
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter(Boolean),
        oauthPermissions: String(this.get('TOCHKA_OAUTH_PERMISSIONS') ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        oauthConsentExpiresAt: this.get('TOCHKA_OAUTH_CONSENT_EXPIRES_AT') as
          | string
          | undefined,
        webhookUrl: this.get('TOCHKA_WEBHOOK_URL') as string | undefined,
        webhookEventTypes: String(
          this.get('TOCHKA_WEBHOOK_EVENT_TYPES') ?? 'acquiringInternetPayment',
        )
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        webhookAutoRegister: this.get('TOCHKA_WEBHOOK_AUTO_REGISTER') === true,
        webhookPublicKeyUrl: String(
          this.get('TOCHKA_WEBHOOK_PUBLIC_KEY_URL') ??
            'https://enter.tochka.com/doc/openapi/static/keys/public',
        ),
      },
      dadata: {
        apiKey: customDadataKey.length > 0 ? customDadataKey : undefined,
        isConfigured: customDadataKey.length > 0,
      },
      innLookup: {
        provider: String(this.get('INN_LOOKUP_PROVIDER') ?? 'mock') as
          | 'mock'
          | 'dadata'
          | 'tochka_then_dadata',
        cacheTtlDays: Number(this.get('INN_LOOKUP_CACHE_TTL_DAYS') ?? 30),
      },
    } as const;
  }

  // Удобный шорткат для main.ts
  get port(): number {
    return this.runtime.port;
  }

  // ─────────────────────────── dynamic (admin-redesign Фаза 0) ─────────
  /**
   * Прочитать «живую» настройку: сначала из `AdminSetting` (через
   * `AdminSettingsService.get(key)`), затем — fallback на ENV (`envFallbackKey`),
   * затем — `defaultValue`. Бросает `Error`, только если все три источника
   * не дали значения.
   *
   * Lazy-инжекция через `ModuleRef.get(...)` нужна, чтобы избежать
   * круговой зависимости `common/config → modules/admin/settings`. Если
   * `AdminSettingsService` не зарегистрирован (тесты, минимальный bootstrap),
   * метод тихо переходит на ENV/default.
   */
  async getDynamic<T>(
    key: string,
    // NB: envFallbackKey: keyof Env упирается в TS2589 (excessively deep) на
    // .merge цепочке EnvSchema — TS сужает union до `never|undefined`,
    // ломая call-site'ы. Принимаем как `string` и cast'им через `unknown`
    // внутри (внешняя проверка ENV-имени — code review + типизация на месте).
    envFallbackKey?: string,
    defaultValue?: T,
  ): Promise<T> {
    const reader = this.resolveAdminReader();
    if (reader) {
      try {
        const fromDb = await reader.get<T>(key);
        if (fromDb !== undefined && fromDb !== null) {
          return fromDb;
        }
      } catch (err) {
        // Сбой чтения админ-настройки не должен ломать бизнес-логику —
        // даём шанс ENV/default.
        this.logger.warn(
          { err: err instanceof Error ? err.message : String(err), key },
          'getDynamic: AdminSettingsService.get() сбой, падаем на ENV',
        );
      }
    }
    if (envFallbackKey !== undefined) {
      const fromEnv = this.get(envFallbackKey);
      if (fromEnv !== undefined && fromEnv !== null) {
        return fromEnv as T;
      }
    }
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(
      `TypedConfigService.getDynamic: значение для "${key}" не найдено ни в AdminSetting, ни в ENV${envFallbackKey ? ` (${String(envFallbackKey)})` : ''}, ни в defaultValue`,
    );
  }

  private resolveAdminReader(): DynamicAdminSettingsReader | null {
    if (this.adminReader !== undefined) return this.adminReader;
    if (!this.moduleRef) {
      this.adminReader = null;
      return null;
    }
    try {
      // strict: false — ищем в любом модуле приложения.
      const svc = this.moduleRef.get<DynamicAdminSettingsReader>(
        ADMIN_SETTINGS_READER_TOKEN,
        { strict: false },
      );
      this.adminReader = svc ?? null;
    } catch {
      this.adminReader = null;
    }
    return this.adminReader;
  }

  // ─────────────────────────── sync admin-setting cache ─────────────────
  /**
   * Залить весь набор AdminSetting в синхронный кэш TypedConfigService.
   * Вызывается AdminSettingsBootstrapService на onApplicationBootstrap.
   * Идемпотентен — повторный вызов заменяет содержимое.
   */
  hydrateSync(entries: Iterable<[string, unknown]>): void {
    this.cacheMap.clear();
    for (const [k, v] of entries) {
      this.cacheMap.set(k, v);
    }
    this.resolveSourceLogged.clear();
  }

  /**
   * Применить одно изменение (от AdminSettingsService.set() локально или
   * через pub/sub из другого процесса). value=undefined — удалить ключ
   * из cacheMap (resolveSync упадёт на ENV/default).
   */
  applySync(key: string, value: unknown | undefined): void {
    if (value === undefined) {
      this.cacheMap.delete(key);
    } else {
      this.cacheMap.set(key, value);
    }
    // Сбросить «один раз залогированный источник», чтобы новое решение
    // (cache vs env vs default) залогировалось ещё раз.
    for (const tag of Array.from(this.resolveSourceLogged)) {
      if (tag.startsWith(`${key}:`)) this.resolveSourceLogged.delete(tag);
    }
  }

  /**
   * Синхронное чтение настройки: cacheMap → ENV (envFallbackKey) →
   * defaultValue. Throws, если все три источника пусты.
   *
   * Sync (не async) — чтобы вызываться из @Cron, guards, конструкторов
   * сервисов. См. ТЗ env-to-admin-setting-call-sites-migration.
   */
  resolveSync<T>(adminKey: string, envFallbackKey?: string, defaultValue?: T): T {
    if (this.cacheMap.has(adminKey)) {
      this.logSourceOnce(adminKey, 'cache');
      return this.cacheMap.get(adminKey) as T;
    }
    if (envFallbackKey !== undefined) {
      const fromEnv = this.get(envFallbackKey);
      if (fromEnv !== undefined && fromEnv !== null) {
        this.logSourceOnce(adminKey, 'env');
        return fromEnv as T;
      }
    }
    if (defaultValue !== undefined) {
      this.logSourceOnce(adminKey, 'default');
      return defaultValue;
    }
    // Фаза 4: смягчение throw. Если envFallbackKey передан — значит, вызывающая
    // сторона осознанно сообщила «значение может отсутствовать» (например,
    // `EMBEDDING_FALLBACK_LOCAL_URL` помечен `.optional()` в схеме). В этом
    // случае возвращаем undefined вместо ошибки — это правильная семантика
    // optional-ENV. Бросаем только если envFallbackKey не задан вообще.
    if (envFallbackKey !== undefined) {
      this.logSourceOnce(adminKey, 'env');
      return undefined as T;
    }
    throw new Error(
      `TypedConfigService.resolveSync: "${adminKey}" не найден ни в cache, ни в ENV, ни в defaultValue`,
    );
  }

  private logSourceOnce(adminKey: string, source: 'cache' | 'env' | 'default'): void {
    const tag = `${adminKey}:${source}`;
    if (this.resolveSourceLogged.has(tag)) return;
    this.resolveSourceLogged.add(tag);
    this.logger.debug({ adminKey, source }, 'resolveSync');
  }

  /**
   * Параметры эталонной демо-Org «Демо: ТехноСтрим». Если `referenceOrgId=null` —
   * shared-demo-org-model выключен (новые пользователи не подключаются как
   * наблюдатели). См. ТЗ plans/tz/2026-06-01-demo-shared-org-model.md §4.6.
   *
   * 2026-06-01.
   */
  get demo(): { referenceOrgId: string | null } {
    const id = this.get('ZDEMO_ORG_ID');
    return {
      referenceOrgId: typeof id === 'string' && id.length > 0 ? id : null,
    };
  }
}
