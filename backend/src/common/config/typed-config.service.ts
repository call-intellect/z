import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from './env.schema';

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
  constructor(
    // NB: убрали generic ConfigService<Env, true> — на агрегированной схеме
    // (~50 .merge), Env-union триггерит TS2589 ещё при объявлении конструктора.
    // Типизация Env-значений делается на уровне приватного `get` ниже.
    @Inject(ConfigService) private readonly raw: ConfigService,
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
      sessionTtlSeconds: this.get('SESSION_TTL_SECONDS'),
      deepLinkTtlSeconds: this.get('DEEP_LINK_TTL_SECONDS'),
    } as const;
  }

  // ─────────────────────────── argon (standalone passwords) ─────
  get argon() {
    return {
      memoryKb: this.get('ARGON_MEMORY_KB'),
      iterations: this.get('ARGON_ITERATIONS'),
      parallelism: this.get('ARGON_PARALLELISM'),
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
      },
      openai: {
        apiKey: this.get('OPENAI_API_KEY'),
        baseUrl: this.get('OPENAI_BASE_URL'),
      },
      deepseek: {
        apiKey: this.get('DEEPSEEK_API_KEY'),
        baseUrl: this.get('DEEPSEEK_BASE_URL'),
        defaultModel: this.get('DEEPSEEK_DEFAULT_MODEL'),
      },
      ollama: {
        baseUrl: this.get('OLLAMA_BASE_URL'),
        apiKey: this.get('OLLAMA_API_KEY'),
      },
      minimax: {
        apiKey: this.get('MINIMAX_API_KEY'),
        baseUrl: this.get('MINIMAX_BASE_URL'),
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
      embeddings: {
        provider: this.get('EMBEDDING_PROVIDER'),
        model: this.get('EMBEDDING_MODEL'),
        dimensions: this.get('EMBEDDING_DIMENSIONS'),
        proxyApiKey: this.get('OPENAI_PROXY_API_KEY'),
        proxyEmbeddingsUrl: this.get('OPENAI_PROXY_EMBEDDINGS_URL'),
        fallbackLocalUrl: this.get('EMBEDDING_FALLBACK_LOCAL_URL'),
        batchSize: this.get('EMBEDDING_BATCH_SIZE'),
        chunkTargetTokens: this.get('EMBEDDING_CHUNK_TARGET_TOKENS'),
        chunkOverlapTokens: this.get('EMBEDDING_CHUNK_OVERLAP_TOKENS'),
      },
    } as const;
  }

  // ─────────────────────────── crossmark ─────────────────────────
  get crossmark() {
    return {
      hmacTimestampWindowSeconds: this.get('CROSSMARK_HMAC_TIMESTAMP_WINDOW_SECONDS'),
    } as const;
  }

  // ─────────────────────────── retention ─────────────────────────
  get retention() {
    return {
      defaultDays: this.get('DEFAULT_RETENTION_DAYS'),
      cron: this.get('RETENTION_CRON'),
      softDeleteGraceDays: this.get('SOFT_DELETE_GRACE_DAYS'),
      webhookDeliveryDays: this.get('WEBHOOK_DELIVERY_RETENTION_DAYS'),
      shareViewDays: this.get('SHARE_VIEW_RETENTION_DAYS'),
      apiAccessLogDays: this.get('API_ACCESS_LOG_RETENTION_DAYS'),
      // ── Фаза 11: knowledge-core retention sweeps ──
      sweepBatchSize: this.get('RETENTION_SWEEP_BATCH_SIZE'),
      rawEventsEnabled: this.get('RETENTION_RAW_EVENTS_ENABLED'),
      auditEnabled: this.get('RETENTION_AUDIT_ENABLED'),
      chatEnabled: this.get('RETENTION_CHAT_ENABLED'),
      blocksEnabled: this.get('RETENTION_BLOCKS_ENABLED'),
    } as const;
  }

  // ─────────────────────────── webhooks-out ──────────────────────
  get webhooksOut() {
    return {
      encryptionKey: this.get('WEBHOOK_SECRETS_ENCRYPTION_KEY'),
      deliveryTimeoutMs: this.get('WEBHOOK_DELIVERY_TIMEOUT_MS'),
      maxAttempts: this.get('WEBHOOK_MAX_ATTEMPTS'),
      egressAllowedHosts: (
        this.get('WEBHOOK_EGRESS_ALLOWED_HOSTS') as string
      )
        .split(',')
        .map((h: string) => h.trim())
        .filter(Boolean),
    } as const;
  }

  // ─────────────────────────── workspace limits / quotas ────────
  get workspace() {
    return {
      clipMaxDurationSeconds: this.get('CLIP_MAX_DURATION_SECONDS'),
      exportZipMaxMeetings: this.get('EXPORT_ZIP_MAX_MEETINGS'),
      exportZipMaxBytes: this.get('EXPORT_ZIP_MAX_SIZE_BYTES'),

      maxApiKeysPerUser: this.get('MAX_API_KEYS_PER_USER'),
      maxWebhookSubscriptionsPerUser: this.get('MAX_WEBHOOK_SUBSCRIPTIONS_PER_USER'),
      maxDestinationsPerUser: this.get('MAX_DESTINATIONS_PER_USER'),
      maxTagsPerUser: this.get('MAX_TAGS_PER_USER'),
      maxUserTemplatesPerUser: this.get('MAX_USER_TEMPLATES_PER_USER'),

      maxChatRequestsPerDay: this.get('MAX_CHAT_REQUESTS_PER_DAY'),
      maxChatTokensPerDay: this.get('MAX_CHAT_TOKENS_PER_DAY'),
      maxRenderJobsPerHour: this.get('MAX_RENDER_JOBS_PER_HOUR'),
      maxBulkExportsPerDay: this.get('MAX_BULK_EXPORTS_PER_DAY'),
      maxRegeneratePerMeetingPerDay: this.get('MAX_REGENERATE_PER_MEETING_PER_DAY'),
      maxMeetingsCreatedPerDayViaApi: this.get('MAX_MEETINGS_CREATED_PER_DAY_VIA_API'),
      maxEmbeddingTokensPerMonth: this.get('MAX_EMBEDDING_TOKENS_PER_MONTH_PER_USER'),

      maxHighlightsPerMeeting: this.get('MAX_HIGHLIGHTS_PER_MEETING'),
      maxBulkOperationIds: this.get('MAX_BULK_OPERATION_IDS'),
      maxChatMessageChars: this.get('MAX_CHAT_MESSAGE_CHARS'),
      maxRoomMessageChars: this.get('MAX_ROOM_MESSAGE_CHARS'),

      maxCardsPerUser: this.get('MAX_CARDS_PER_USER'),
      maxCardRollupsPerDay: this.get('MAX_CARD_ROLLUPS_PER_DAY'),
      /** Phase 9: ручной пересчёт strategic-alignment по Goal (на Org). */
      maxGoalRecomputePerDay: this.get('MAX_GOAL_RECOMPUTE_PER_DAY'),
    } as const;
  }

  // ─────────────────────────── ai feature flags ─────────────────
  /**
   * Feature-flags AI-pipeline. Отдельный геттер, чтобы не раздувать
   * `cfg.ai` (там и так много провайдеров).
   */
  get aiFeatures() {
    return {
      includeRoomChat: this.get('INCLUDE_ROOM_CHAT_IN_AI'),
      /**
       * Фаза D (sub-TZ §6.2) — включает LLM-уточнение уровня 2 в воркере
       * `ai.transcript-clean`. При false воркер работает только через
       * детерминистский уровень 1.
       */
      transcriptCleaningLlmRefine: this.get('TRANSCRIPT_CLEANING_LLM_REFINE_ENABLED'),
      /**
       * Фаза B (sub-TZ 2026-05-21-phase-B §7) — включает LLM-refine
       * в воркере `ai.behavior-metrics`. По умолчанию false.
       */
      behaviorMetricsLlmRefine: this.get('BEHAVIOR_METRICS_LLM_REFINE_ENABLED'),
    } as const;
  }

  get hashing() {
    return {
      ipDailySalt: this.get('IP_HASH_DAILY_SALT'),
    } as const;
  }

  get share() {
    return {
      tokenLengthBytes: this.get('SHARE_TOKEN_LENGTH_BYTES'),
      defaultExpirationDays: this.get('SHARE_DEFAULT_EXPIRATION_DAYS'),
      allowedExpirationDays: this.get('SHARE_ALLOWED_EXPIRATION_DAYS') as readonly number[],
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
      enabled: this.get('EMAIL_FETCH_ENABLED'),
      cron: this.get('EMAIL_FETCH_CRON'),
      maxPerRun: this.get('EMAIL_FETCH_MAX_PER_RUN'),
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
      linkMinConfidence: this.get('LINK_MIN_CONFIDENCE'),
      linkerMinBlocks: this.get('LINKER_MIN_BLOCKS'),
      linkKnnTopK: this.get('LINK_KNN_TOP_K'),
      reframingCron: this.get('REFRAMING_CRON'),
      blockDynamicScoreDecayDays: this.get('BLOCK_DYNAMIC_SCORE_DECAY_DAYS'),
      entityGraphBuilderCron: this.get('ENTITY_GRAPH_BUILDER_CRON'),
      entityGraphMinComentions: this.get('ENTITY_GRAPH_MIN_COMENTIONS'),
      // Фаза 4: Theme + card-rollup-v2.
      themeClustererCron: this.get('THEME_CLUSTERER_CRON'),
      themeClusteringMinBlocks: this.get('THEME_CLUSTERING_MIN_BLOCKS'),
      themeClusterMinSize: this.get('THEME_CLUSTER_MIN_SIZE'),
      themeCosineThreshold: this.get('THEME_COSINE_THRESHOLD'),
      cardRollupV2DebounceMs: this.get('CARD_ROLLUP_V2_DEBOUNCE_MS'),
      // Фаза 5: meeting-analyze-v2 (Tasks-2.0/Chapters-2.0/Summary-2.0).
      v2AgentsEnabled: this.get('KNOWLEDGE_CORE_V2_AGENTS_ENABLED'),
      meetingAnalyzeV2Cron: this.get('MEETING_ANALYZE_V2_CRON'),
      meetingAnalyzeV2DebounceMs: this.get('MEETING_ANALYZE_V2_DEBOUNCE_MS'),
      // Фаза 6: ChatV2 (единый AI-чат поверх IdeaBlock'ов).
      chatV2Enabled: this.get('CHAT_V2_ENABLED'),
      chatV2TopBlocks: this.get('CHAT_V2_TOP_BLOCKS'),
      chatV2GraphHops: this.get('CHAT_V2_GRAPH_HOPS'),
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
   *   - `staleDetectorCron` — расписание CardStaleDetectorCron.
   *   - `staleMonthsThreshold` — порог `lastConfirmedAt > N мес.`.
   *   - `staleDynamicScoreThreshold` — порог упавшего `dynamicScore`.
   */
  get curation() {
    return {
      autoThresholdDefault: this.get('CURATION_AUTO_THRESHOLD_DEFAULT'),
      deepReviewThresholdDefault: this.get('CURATION_DEEP_REVIEW_THRESHOLD_DEFAULT'),
      criticalTypesDefault: this.get(
        'CURATION_CRITICAL_TYPES_DEFAULT',
      ) as readonly string[],
      itemExpiryDays: this.get('CURATION_ITEM_EXPIRY_DAYS'),
      staleDetectorCron: this.get('CARD_STALE_DETECTOR_CRON'),
      staleMonthsThreshold: this.get('CARD_STALE_MONTHS_THRESHOLD'),
      staleDynamicScoreThreshold: this.get('CARD_STALE_DYNAMIC_SCORE_THRESHOLD'),
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
      timeoutMinutes: this.get('IDLE_MEETING_TIMEOUT_MINUTES'),
      cron: this.get('IDLE_MEETING_CRON'),
    } as const;
  }

  // ─────────────────────────── quotas ────────────────────────────
  get quotas() {
    return {
      maxParticipantsPerMeeting: this.get('MAX_PARTICIPANTS_PER_MEETING'),
      maxMeetingDurationHours: this.get('MAX_MEETING_DURATION_HOURS'),
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
    } as const;
  }

  // Удобный шорткат для main.ts
  get port(): number {
    return this.runtime.port;
  }
}
