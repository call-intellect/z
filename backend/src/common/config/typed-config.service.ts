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
    @Inject(ConfigService) private readonly raw: ConfigService<Env, true>,
  ) {}

  private get<K extends keyof Env>(key: K): Env[K] {
    return this.raw.get(key, { infer: true }) as Env[K];
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
      egressAllowedHosts: this.get('WEBHOOK_EGRESS_ALLOWED_HOSTS')
        .split(',')
        .map((h) => h.trim())
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

  // ─────────────────────────── admin ─────────────────────────────
  get admin() {
    return {
      bootstrapEmail: this.get('ADMIN_BOOTSTRAP_EMAIL'),
      sessionTtlSeconds: this.get('ADMIN_SESSION_TTL_SECONDS'),
    } as const;
  }

  // Удобный шорткат для main.ts
  get port(): number {
    return this.runtime.port;
  }
}
