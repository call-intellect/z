import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';

export interface DynamicAdminSettingsReader {
  get<T>(key: string, defaultValue?: T): Promise<T | undefined>;
}

export const ADMIN_SETTINGS_READER_TOKEN = 'AdminSettingsService' as const;

@Injectable()
export class TypedConfigService {
  private readonly logger = new Logger(TypedConfigService.name);
  private adminReader: DynamicAdminSettingsReader | null | undefined = undefined;

  private readonly cacheMap = new Map<string, unknown>();
  private readonly resolveSourceLogged = new Set<string>();

  constructor(
    @Inject(ConfigService) private readonly raw: ConfigService,
    @Optional() @Inject(ModuleRef) private readonly moduleRef: ModuleRef | null = null,
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private get(key: string): any {
    return (this.raw as unknown as { get(k: string): unknown }).get(key);
  }

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

  get persons() {
    return {
      useAppointment: this.get('USE_APPOINTMENT_FOR_PERSON_ROLES') as boolean,
    } as const;
  }

  get logging() {
    return {
      dbLoggingEnabled: this.resolveSync<boolean>('logging.dbLoggingEnabled', 'LOG_DB_ENABLED', true),
      minLevel: this.resolveSync<string>('logging.minLevel', 'LOG_DB_MIN_LEVEL', 'INFO'),
      batchSize: this.resolveSync<number>('logging.batchSize', 'LOG_DB_BATCH_SIZE', 50),
      flushIntervalMs: this.resolveSync<number>(
        'logging.flushIntervalMs',
        'LOG_DB_FLUSH_INTERVAL_MS',
        5_000,
      ),
      maxBufferSize: this.resolveSync<number>('logging.maxBufferSize', 'LOG_DB_MAX_BUFFER', 5_000),
      retentionDays: this.resolveSync<number>(
        'logging.retentionDays',
        'LOG_DB_RETENTION_DAYS',
        30,
      ),
      logStackTraces: this.resolveSync<boolean>(
        'logging.logStackTraces',
        'LOG_DB_STACK_TRACES',
        true,
      ),
      requestBodyLogging: this.resolveSync<boolean>(
        'logging.requestBodyLogging',
        'LOG_DB_REQUEST_BODY',
        false,
      ),
      responseBodyLogging: this.resolveSync<boolean>(
        'logging.responseBodyLogging',
        'LOG_DB_RESPONSE_BODY',
        false,
      ),
      logSuccessfulRequests: this.resolveSync<boolean>(
        'logging.logSuccessfulRequests',
        'LOG_DB_SUCCESS_REQUESTS',
        false,
      ),
      slowRequestThresholdMs: this.resolveSync<number>(
        'logging.slowRequestThresholdMs',
        'LOG_DB_SLOW_REQUEST_MS',
        2_000,
      ),
    } as const;
  }

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

  get auth() {
    const rawDomain = this.get('COOKIE_DOMAIN');
    const standaloneRaw = this.get('COOKIE_STANDALONE_DOMAIN') ?? rawDomain;
    const isLocal = (d: string) =>
      d === 'localhost' || d === '.localhost' || d.endsWith('.localhost');
    return {
      sessionSecret: this.get('JWT_SESSION_SECRET'),
      deepLinkSecret: this.get('JWT_DEEP_LINK_SECRET'),
      cookieDomain: isLocal(rawDomain) ? undefined : rawDomain,
      cookieStandaloneDomain: isLocal(standaloneRaw) ? undefined : standaloneRaw,
      publicFrontendUrl: this.get('PUBLIC_FRONTEND_URL'),
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

  get argon() {
    return {
      memoryKb: this.resolveSync<number>('security.argonMemoryKb', 'ARGON_MEMORY_KB', 19_456),
      iterations: this.resolveSync<number>('security.argonIterations', 'ARGON_ITERATIONS', 2),
      parallelism: this.resolveSync<number>('security.argonParallelism', 'ARGON_PARALLELISM', 1),
    } as const;
  }

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

  get cors() {
    const allowed: string[] = [this.get('PUBLIC_FRONTEND_URL')];
    if (this.runtime.isDevelopment) {
      allowed.push('http://localhost:3000', 'http://localhost:3001');
    }
    return { allowed } as const;
  }

  get livekit() {
    return {
      apiUrl: this.get('LIVEKIT_API_URL'),
      apiKey: this.get('LIVEKIT_API_KEY'),
      apiSecret: this.get('LIVEKIT_API_SECRET'),
      webhookApiKey: this.get('LIVEKIT_WEBHOOK_API_KEY'),
      webhookApiSecret: this.get('LIVEKIT_WEBHOOK_API_SECRET'),
      webhookAckFirstEnabled: this.resolveSync<boolean>(
        'livekit.webhookAckFirstEnabled',
        'LIVEKIT_WEBHOOK_ACK_FIRST_ENABLED',
        false,
      ),
    } as const;
  }

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

  get llmRouter() {
    return {
      dispatchTimeoutMs: this.get('LLM_ROUTER_DISPATCH_TIMEOUT_MS'),
    } as const;
  }

  get llm() {
    return {
      cacheSmokeEnabled: this.resolveSync<boolean>('llm.cacheSmokeEnabled', undefined, true),
      cacheHitRatioWarnThreshold: this.resolveSync<number>(
        'llm.cacheHitRatioWarnThreshold',
        undefined,
        0.6,
      ),
    } as const;
  }

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
        dimensions: this.resolveSync<number>('embeddings.dimensions', 'EMBEDDING_DIMENSIONS', 1536),
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
        batchSize: this.resolveSync<number>('embeddings.batchSize', 'EMBEDDING_BATCH_SIZE', 100),
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

  get crossmark() {
    return {
      hmacTimestampWindowSeconds: this.resolveSync<number>(
        'crossmark.hmacTimestampWindowSeconds',
        'CROSSMARK_HMAC_TIMESTAMP_WINDOW_SECONDS',
        300,
      ),
    } as const;
  }

  get retention() {
    return {
      defaultDays: this.resolveSync<number>('retention.defaultDays', 'DEFAULT_RETENTION_DAYS', 30),
      cron: this.resolveSync<string>('retention.cron', 'RETENTION_CRON', '0 * * * *'),
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

  get webhooksOut() {
    return {
      encryptionKey: this.get('WEBHOOK_SECRETS_ENCRYPTION_KEY'),
      deliveryTimeoutMs: this.resolveSync<number>(
        'webhook.deliveryTimeoutMs',
        'WEBHOOK_DELIVERY_TIMEOUT_MS',
        10_000,
      ),
      maxAttempts: this.resolveSync<number>('webhook.maxAttempts', 'WEBHOOK_MAX_ATTEMPTS', 8),
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
      maxTagsPerUser: this.resolveSync<number>('limits.maxTagsPerUser', 'MAX_TAGS_PER_USER', 50),
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
      maxGoalRecomputePerDay: this.resolveSync<number>(
        'limits.maxGoalRecomputePerDay',
        'MAX_GOAL_RECOMPUTE_PER_DAY',
        5,
      ),
    } as const;
  }

  get aiFeatures() {
    return {
      includeRoomChat: this.resolveSync<boolean>(
        'aiFeatures.includeRoomChat',
        'INCLUDE_ROOM_CHAT_IN_AI',
        true,
      ),
      transcriptCleaningLlmRefine: this.resolveSync<boolean>(
        'aiFeatures.transcriptCleaningLlmRefine',
        'TRANSCRIPT_CLEANING_LLM_REFINE_ENABLED',
        true,
      ),
      behaviorMetricsLlmRefine: this.resolveSync<boolean>(
        'aiFeatures.behaviorMetricsLlmRefine',
        'BEHAVIOR_METRICS_LLM_REFINE_ENABLED',
        false,
      ),
      promptInjectionGuardEnabled: this.resolveSync<boolean>(
        'aiFeatures.promptInjectionGuardEnabled',
        'PROMPT_INJECTION_GUARD_ENABLED',
        true,
      ),
      summaryAgentEnabled: this.resolveSync<boolean>(
        'aiFeatures.summaryAgentEnabled',
        'SUMMARY_AGENT_ENABLED',
        true,
      ),
      clientProtocolEnabled: this.resolveSync<boolean>(
        'aiFeatures.clientProtocolEnabled',
        'CLIENT_PROTOCOL_ENABLED',
        true,
      ),
      docCompilerEnabled: this.resolveSync<boolean>(
        'aiFeatures.docCompilerEnabled',
        'DOC_COMPILER_ENABLED',
        true,
      ),
      regulationGateStrict: this.resolveSync<boolean>(
        'aiFeatures.regulationGateStrict',
        'REGULATION_GATE_STRICT_ENABLED',
        true,
      ),
      regulationMinMaterializeConfidence: this.resolveSync<number>(
        'aiFeatures.regulationMinMaterializeConfidence',
        undefined,
        0.6,
      ),
      regulationConsolidatorEnabled: this.resolveSync<boolean>(
        'aiFeatures.regulationConsolidatorEnabled',
        undefined,
        true,
      ),
      chatboxTaskExtractionEnabled: this.resolveSync<boolean>(
        'chatbox.taskExtraction.enabled',
        'CHATBOX_TASK_EXTRACTION_ENABLED',
        true,
      ),
      tasksCrossSourceDedupeEnabled: this.resolveSync<boolean>(
        'tasks.crossSourceDedupe.enabled',
        'TASKS_CROSS_SOURCE_DEDUPE_ENABLED',
        true,
      ),
      crossSourceDedupeThreshold: this.resolveSync<number>(
        'tasks.cross_source_dedupe_threshold',
        undefined,
        0.85,
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

  get ingest() {
    return {
      internalToken: this.get('INGEST_INTERNAL_TOKEN'),
    } as const;
  }

  get crypto() {
    return {
      masterKey: this.get('CRYPTO_MASTER_KEY'),
    } as const;
  }

  get publicHostUrl(): string {
    const host = this.get('PUBLIC_HOST_URL');
    if (host) return host.replace(/\/+$/, '');
    return this.get('PUBLIC_FRONTEND_URL').replace(/\/+$/, '');
  }

  get emailFetch() {
    return {
      enabled: this.resolveSync<boolean>('emailFetch.enabled', 'EMAIL_FETCH_ENABLED', false),
      cron: this.resolveSync<string>('emailFetch.cron', 'EMAIL_FETCH_CRON', '*/5 * * * *'),
      maxPerRun: this.resolveSync<number>('emailFetch.maxPerRun', 'EMAIL_FETCH_MAX_PER_RUN', 50),
    } as const;
  }

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

  get knowledgeCore() {
    return {
      distillMergeThreshold: this.get('DISTILL_MERGE_THRESHOLD'),
      distillDebounceMs: this.get('DISTILL_DEBOUNCE_MS'),
      distillKnnTopK: this.get('DISTILL_KNN_TOP_K'),
      regulationDedupeTopK: this.resolveSync<number>(
        'knowledge.regulationDedupeTopK',
        'REGULATION_DEDUPE_TOP_K',
        12,
      ),
      entityMergeThreshold: this.get('ENTITY_MERGE_THRESHOLD'),
      entityResolverCron: this.get('ENTITY_RESOLVER_CRON'),
      regulationConsolidatorCron: this.get('REGULATION_CONSOLIDATOR_CRON'),
      blockIngestWindowSegments: this.get('BLOCK_INGEST_WINDOW_SEGMENTS'),
      blockIngestMaxTokensPerSegment: this.get('BLOCK_INGEST_MAX_TOKENS_PER_SEGMENT'),
      searchCosineWeight: this.get('SEARCH_COSINE_WEIGHT'),
      searchBm25Weight: this.get('SEARCH_BM25_WEIGHT'),
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
      v2AgentsEnabled: this.get('KNOWLEDGE_CORE_V2_AGENTS_ENABLED'),
      meetingAnalyzeV2Cron: this.get('MEETING_ANALYZE_V2_CRON'),
      meetingAnalyzeV2DebounceMs: this.get('MEETING_ANALYZE_V2_DEBOUNCE_MS'),
      meetingReportFastEnabled: this.get('MEETING_REPORT_FAST_ENABLED'),
      reportIngestEnabled: this.get('REPORT_INGEST_ENABLED'),
      chatV2Enabled: this.get('CHAT_V2_ENABLED'),
      chatV2TopBlocks: this.get('CHAT_V2_TOP_BLOCKS'),
      chatV2GraphHops: this.get('CHAT_V2_GRAPH_HOPS'),
      chatV2SynthesisTimeoutMs: this.resolveSync<number>(
        'knowledge.chatV2SynthesisTimeoutMs',
        undefined,
        90_000,
      ),
      biTemporalEdgesEnabled: this.get('BI_TEMPORAL_EDGES_ENABLED'),
      ideaDirectPathEnabled: this.resolveSync<boolean>(
        'knowledge.ideaDirectPathEnabled',
        undefined,
        true,
      ),
      taskDedupeEnabled: this.resolveSync<boolean>('meetings.taskDedupeEnabled', undefined, false),
      taskDedupeThreshold: this.resolveSync<number>(
        'meetings.taskDedupeThreshold',
        undefined,
        0.85,
      ),
    } as const;
  }

  get graph() {
    return {
      ageEnabled: this.resolveSync<boolean>('graph.ageEnabled', 'GRAPH_AGE_ENABLED', true),
    } as const;
  }

  get supportDesk() {
    return {
      enabled: this.resolveSync<boolean>('support_desk.enabled', 'SUPPORT_DESK_ENABLED', true),
      curatorEnabled: this.resolveSync<boolean>(
        'support_desk.curator_enabled',
        'SUPPORT_CURATOR_ENABLED',
        true,
      ),
    } as const;
  }

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
      factSupersedeCosineThreshold: this.get('FACT_SUPERSEDE_COSINE_THRESHOLD') as number,
      factSupersedeKnnTopK: this.get('FACT_SUPERSEDE_KNN_TOP_K') as number,
      factSupersedeCostAlertPct: this.get('FACT_SUPERSEDE_COST_ALERT_PCT') as number,
    } as const;
  }

  get entityIngest() {
    return {
      resolveThreshold: this.get('ENTITY_INGEST_RESOLVE_THRESHOLD') as number,
      cacheTtlSeconds: this.get('ENTITY_INGEST_RESOLVE_CACHE_TTL_S') as number,
    } as const;
  }

  get projectionRebuild() {
    return {
      debounceMs: this.get('PROJECTION_REBUILD_DEBOUNCE_MS') as number,
    } as const;
  }

  get debate() {
    return {
      enabled: this.get('MULTI_AGENT_DEBATE_ENABLED') as boolean,
      defaultN: this.get('DEBATE_DEFAULT_N') as number,
      defaultRounds: this.get('DEBATE_DEFAULT_ROUNDS') as number,
      round2Enabled: this.get('DEBATE_ROUND2_ENABLED') as boolean,
      costCapUsdPerRun: this.get('DEBATE_COST_CAP_USD_PER_RUN') as number,
    } as const;
  }

  get autorule() {
    return {
      enabled: this.get('AUTORULE_ENABLED') as boolean,
      minFeedbackForExtract: this.get('AUTORULE_MIN_FEEDBACK_FOR_EXTRACT') as number,
      minConfidenceForPromote: this.get('AUTORULE_MIN_CONFIDENCE_FOR_PROMOTE') as number,
      knnGroupThreshold: this.get('AUTORULE_KNN_GROUP_THRESHOLD') as number,
      ruleSimilarityThreshold: this.get('AUTORULE_RULE_SIMILARITY_THRESHOLD') as number,
    } as const;
  }

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

  get gepa() {
    return {
      enabled: this.get('PROMPT_EVOLUTION_ENABLED') as boolean,
      maxMetricCalls: this.get('GEPA_MAX_METRIC_CALLS') as number,
      reflectionLm: this.get('GEPA_REFLECTION_LM') as string,
      taskLm: this.get('GEPA_TASK_LM') as string,
      abTrafficShare: this.get('GEPA_AB_TRAFFIC_SHARE') as number,
      abMinInvocationsBeforeDecision: this.get('GEPA_AB_MIN_INVOCATIONS_BEFORE_DECISION') as number,
      abPromoteThreshold: this.get('GEPA_AB_PROMOTE_THRESHOLD') as number,
      abRejectThreshold: this.get('GEPA_AB_REJECT_THRESHOLD') as number,
      serviceUrl: this.get('GEPA_SERVICE_URL') as string,
      timeoutMs: this.get('GEPA_TIMEOUT_MS') as number,
    } as const;
  }

  get chatV2() {
    return {
      historyMessages: this.get('CHAT_V2_HISTORY_MESSAGES'),
      conversationTtlDays: this.get('CHAT_V2_CONVERSATION_TTL_DAYS'),
      cleanupCron: this.get('CHAT_V2_CLEANUP_CRON'),
      defaultMode: this.get('CHAT_V2_DEFAULT_MODE'),
      streamingEnabled: this.get('CHAT_V2_STREAMING_ENABLED'),
    } as const;
  }

  get document() {
    const customBucket = this.get('S3_BUCKET_DOCUMENTS');
    return {
      parseTimeoutMs: this.get('DOCUMENT_PARSE_TIMEOUT_MS'),
      maxSizeMb: this.get('DOCUMENT_MAX_SIZE_MB'),
      maxSizeBytes: this.get('DOCUMENT_MAX_SIZE_MB') * 1024 * 1024,
      inlineThresholdMb: this.get('DOCUMENT_INLINE_THRESHOLD_MB'),
      inlineThresholdBytes: this.get('DOCUMENT_INLINE_THRESHOLD_MB') * 1024 * 1024,
      s3Bucket: customBucket && customBucket.length > 0 ? customBucket : this.get('S3_BUCKET'),
    } as const;
  }

  async documentLimits(): Promise<{
    maxSizeMb: number;
    maxSizeBytes: number;
    maxFilesPerUpload: number;
    acceptedFormats: readonly string[];
    maxZipSizeMb: number;
    maxZipSizeBytes: number;
  }> {
    const [maxSizeMb, maxFilesPerUpload, acceptedFormats, maxZipSizeMb] = await Promise.all([
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

  get smartTables() {
    const importMaxFileMb = this.resolveSync<number>(
      'smartTables.importMaxFileMb',
      'TABLE_IMPORT_MAX_FILE_MB',
      25,
    );
    return {
      maxRowsPerTable: this.resolveSync<number>(
        'smartTables.maxRowsPerTable',
        'TABLE_MAX_ROWS_PER_TABLE',
        100_000,
      ),
      maxPropsPerTable: this.resolveSync<number>(
        'smartTables.maxPropsPerTable',
        'TABLE_MAX_PROPS_PER_TABLE',
        200,
      ),
      maxTablesPerOrg: this.resolveSync<number>(
        'smartTables.maxTablesPerOrg',
        'TABLE_MAX_TABLES_PER_ORG',
        1_000,
      ),
      maxCellSizeBytes: this.resolveSync<number>(
        'smartTables.maxCellSizeBytes',
        'TABLE_MAX_CELL_SIZE_BYTES',
        1_048_576,
      ),
      importMaxFileMb,
      importMaxFileBytes: importMaxFileMb * 1024 * 1024,
      importMaxRows: this.resolveSync<number>(
        'smartTables.importMaxRows',
        'TABLE_IMPORT_MAX_ROWS',
        5_000,
      ),
    } as const;
  }

  get extraction() {
    return {
      enableTopLevel: this.get('EXTRACTION_ENABLE_TOP_LEVEL'),
      typedEntityMinConfidence: this.get('EXTRACTION_TYPED_ENTITY_MIN_CONFIDENCE'),
    } as const;
  }

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

  get telegramBot() {
    return {
      apiBase: this.get('TELEGRAM_BOT_API_BASE').replace(/\/+$/, ''),
      globalRps: this.get('TELEGRAM_BOT_GLOBAL_RPS'),
    } as const;
  }

  get telegramProxy() {
    return {
      enabled: this.get('TELEGRAM_PROXY_ENABLED'),
      apiBase: this.get('TELEGRAM_PROXY_API_BASE').replace(/\/+$/, ''),
      fileBase: this.get('TELEGRAM_PROXY_FILE_BASE').replace(/\/+$/, ''),
      token: this.get('TELEGRAM_PROXY_TOKEN'),
      requestTimeoutMs: this.get('TELEGRAM_PROXY_REQUEST_TIMEOUT_MS'),
      healthIntervalSec: this.get('TELEGRAM_PROXY_HEALTH_INTERVAL_SEC'),
      pingTimeoutSec: this.get('TELEGRAM_PROXY_PING_TIMEOUT_SEC'),
    } as const;
  }

  get maxBot() {
    return {
      apiBase: this.get('MAX_BOT_API_BASE').replace(/\/+$/, ''),
      globalRps: this.get('MAX_BOT_GLOBAL_RPS'),
    } as const;
  }

  get chatbox(): { apiBaseUrl: string } {
    return { apiBaseUrl: this.get('CHATBOX_API_BASE_URL').replace(/\/+$/, '') };
  }

  get bitrix(): {
    clientId: string | undefined;
    clientSecret: string | undefined;
    oauthBaseUrl: string;
  } {
    return {
      clientId: this.get('BITRIX_CLIENT_ID'),
      clientSecret: this.get('BITRIX_CLIENT_SECRET'),
      oauthBaseUrl: this.get('BITRIX_OAUTH_BASE_URL').replace(/\/+$/, ''),
    };
  }

  get bot() {
    return {
      voiceEnabled: this.get('BOT_VOICE_ENABLED'),
      documentEnabled: this.get('BOT_DOCUMENT_ENABLED'),
      intentClassifierEnabled: this.get('BOT_INTENT_CLASSIFIER_ENABLED'),
      assistantChannelRoutingEnabled: this.get('ASSISTANT_CHANNEL_ROUTING_ENABLED'),
      assistantInboundAsyncEnabled: this.get('ASSISTANT_INBOUND_ASYNC_ENABLED'),
    } as const;
  }

  get router() {
    return {
      dispatchConcurrency: this.get('ROUTER_DISPATCH_CONCURRENCY'),
      maxSpecialistsPerBlock: this.get('ROUTER_MAX_SPECIALISTS_PER_BLOCK'),
    } as const;
  }

  get specialistsCombined() {
    return {
      enabled: this.get('SPECIALISTS_COMBINED_ENABLED'),
      delayMs: this.get('SPECIALISTS_COMBINED_DELAY_MS'),
    } as const;
  }

  get knowledgeClone() {
    return {
      rebuildCron: this.get('KNOWLEDGE_CLONE_REBUILD_CRON'),
      lookbackMonths: this.get('KNOWLEDGE_CLONE_LOOKBACK_MONTHS'),
      debounceMs: this.get('KNOWLEDGE_CLONE_DEBOUNCE_MS'),
      minBlocksForProfile: this.get('KNOWLEDGE_CLONE_MIN_BLOCKS_FOR_PROFILE'),
      embeddingFallbackThreshold: this.get('KNOWLEDGE_CLONE_EMBEDDING_FALLBACK_THRESHOLD'),
      minMatchScore: this.get('KNOWLEDGE_CLONE_MIN_MATCH_SCORE'),
    } as const;
  }

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
      criticalTypesDefault: this.get('CURATION_CRITICAL_TYPES_DEFAULT') as readonly string[],
      itemExpiryDays: this.get('CURATION_ITEM_EXPIRY_DAYS'),
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
        0.01,
      ),
      autotuneEnabled: this.resolveSync<boolean>(
        'knowledge.curationAutotuneEnabled',
        undefined,
        true,
      ),
      thresholdMin: this.resolveSync<number>('knowledge.curationThresholdMin', undefined, 0.6),
      thresholdMax: this.resolveSync<number>('knowledge.curationThresholdMax', undefined, 0.97),
      autotuneStep: this.resolveSync<number>('knowledge.curationAutotuneStep', undefined, 0.02),
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
      conflictArbiterEnabled: this.resolveSync<boolean>(
        'knowledge.curationConflictArbiterEnabled',
        undefined,
        true,
      ),
      conflictArbiterMinConfidence: this.resolveSync<number>(
        'knowledge.curationConflictArbiterMinConfidence',
        undefined,
        0.7,
      ),
      conflictArbiterBatchSize: this.resolveSync<number>(
        'knowledge.curationConflictArbiterBatchSize',
        undefined,
        20,
      ),
      staleDetectorCron: this.get('CARD_STALE_DETECTOR_CRON'),
      staleMonthsThreshold: this.get('CARD_STALE_MONTHS_THRESHOLD'),
      staleDynamicScoreThreshold: this.get('CARD_STALE_DYNAMIC_SCORE_THRESHOLD'),
    } as const;
  }

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
        9,
      ),
      reminderStepHours: this.resolveSync<number>(
        'pendingActions.reminderStepHours',
        undefined,
        12,
      ),
      urgentAgeDays: this.resolveSync<number>('pendingActions.urgentAgeDays', undefined, 5),
      reminderLeadDays: this.resolveSync<number>('pendingActions.reminderLeadDays', undefined, 3),
      conflictTtlDays: this.resolveSync<number>('pendingActions.conflictTtlDays', undefined, 16),
      intakeTtlDays: this.resolveSync<number>('pendingActions.intakeTtlDays', undefined, 30),
    } as const;
  }

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
      goalTaskLinkEnabled: this.resolveSync<boolean>('goals.goalTaskLinkEnabled', undefined, false),
    } as const;
  }

  get insights() {
    return {
      clusterThreshold: this.get('INSIGHT_CLUSTER_THRESHOLD'),
      clusterCron: this.get('INSIGHT_CLUSTER_CRON'),
      frequencyWindowDays: this.get('INSIGHT_FREQUENCY_WINDOW_DAYS'),
      spikeRatio: this.get('INSIGHT_SPIKE_RATIO'),
    } as const;
  }

  get ideas() {
    return {
      clusterThreshold: this.get('IDEA_CLUSTER_THRESHOLD'),
      clustererCron: this.get('IDEA_CLUSTERER_CRON'),
      minSupportersForCluster: this.get('IDEA_MIN_SUPPORTERS_FOR_CLUSTER'),
    } as const;
  }

  get probe() {
    return {
      dedupTtlHours: this.get('PROBE_DEDUP_TTL_HOURS'),
      rateLimitPerHour: this.get('PROBE_RATE_LIMIT_PER_USER_PER_HOUR'),
      rateLimitPerDay: this.get('PROBE_RATE_LIMIT_PER_USER_PER_DAY'),
      expiryDays: this.get('PROBE_EXPIRY_DAYS'),
      priorityRefreshCron: this.get('PROBE_PRIORITY_REFRESH_CRON'),
      quietHoursDefaultTzOffsetMin: this.get('PROBE_QUIET_HOURS_DEFAULT_TZ_OFFSET_MIN'),
      coldStartModeHours: this.get('PROBE_COLD_START_MODE_HOURS'),
      responseClassifyEnabled: this.get('PROBE_RESPONSE_CLASSIFY_ENABLED'),
      subjectAddressingEnabled: this.get('PROBE_SUBJECT_ADDRESSING_ENABLED'),
      voiceInputEnabled: this.get('PROBE_VOICE_INPUT_ENABLED'),
      responseClassifyMinConfidence: this.get('PROBE_RESPONSE_CLASSIFY_MIN_CONFIDENCE'),
    } as const;
  }

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
      cloneTopicSimilarityThreshold: this.get('CLONE_TOPIC_SIMILARITY_THRESHOLD'),
      cloneTopicMinBlocks: this.get('CLONE_TOPIC_MIN_BLOCKS'),
      cloneRespondGroundingEnabled: this.get('CLONE_RESPOND_GROUNDING_ENABLED'),
      valueMotivationDetectEnabled: this.resolveSync<boolean>(
        'knowledge.valueMotivationDetectEnabled',
        'VALUE_MOTIVATION_DETECT_ENABLED',
        true,
      ),
      processMarkerDetectEnabled: this.resolveSync<boolean>(
        'knowledge.processMarkerDetectEnabled',
        'PROCESS_MARKER_DETECT_ENABLED',
        true,
      ),
      cdmInterviewEnabled: this.resolveSync<boolean>(
        'knowledge.cdmInterviewEnabled',
        'CDM_INTERVIEW_ENABLED',
        true,
      ),
      personaLayerValidationEnabled: this.resolveSync<boolean>(
        'knowledge.personaLayerValidationEnabled',
        'PERSONA_LAYER_VALIDATION_ENABLED',
        true,
      ),
      personaRebuildTraitDeltaThreshold: this.get('PERSONA_REBUILD_TRAIT_DELTA_THRESHOLD'),
      personaRebuildMaxAgeHours: this.get('PERSONA_REBUILD_MAX_AGE_HOURS'),
      conceptMatchThreshold: this.get('CLONE_CONCEPT_MATCH_THRESHOLD'),
      conceptMergeThreshold: this.get('CLONE_CONCEPT_MERGE_THRESHOLD'),
      conceptArchiveAfterMonths: this.get('CLONE_CONCEPT_ARCHIVE_AFTER_MONTHS'),
    } as const;
  }

  get cloneV2() {
    return {
      enabled: this.get('CLONE_V2_ENABLED'),
    } as const;
  }

  get rolePrinciples() {
    return {
      synthesisEnabled: this.resolveSync<boolean>(
        'knowledge.rolePrincipleSynthesisEnabled',
        'ROLE_PRINCIPLE_SYNTHESIS_ENABLED',
        true,
      ),
    } as const;
  }

  get aiChatQuota() {
    const csv = this.resolveSync<string>(
      'aiChatQuota.adminRoles',
      'AI_CHAT_ADMIN_ROLES',
      'owner,admin,coo',
    );
    return {
      dailyLimitAdmin: this.resolveSync<number>(
        'aiChatQuota.dailyLimitAdmin',
        'AI_CHAT_DAILY_LIMIT_ADMIN',
        50,
      ),
      dailyLimitMember: this.resolveSync<number>(
        'aiChatQuota.dailyLimitMember',
        'AI_CHAT_DAILY_LIMIT_MEMBER',
        20,
      ),
      adminRoles: csv
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean),
    } as const;
  }

  get dialogLayer() {
    return {
      enabled: this.get('DIALOG_LAYER_ENABLED'),
      answerCacheTtlSeconds: this.get('ANSWER_CACHE_TTL_SECONDS'),
      retrievalCacheTtlSeconds: this.get('RETRIEVAL_CACHE_TTL_SECONDS'),
      summarizerMessageThreshold: this.get('SUMMARIZER_MESSAGE_THRESHOLD'),
      multiQueryExpansionEnabled: this.get('MULTI_QUERY_EXPANSION_ENABLED'),
      queryPlanExtractionEnabled: this.get('QUERY_PLAN_EXTRACTION_ENABLED'),
      summarizerCron: this.get('DIALOG_SUMMARIZER_CRON'),
      summarizerKeepLast: this.get('DIALOG_SUMMARIZER_KEEP_LAST'),
      summarizerStalenessHours: this.get('DIALOG_SUMMARIZER_STALENESS_HOURS'),
    } as const;
  }

  get persona() {
    return {
      buildCron: this.get('PERSONA_BUILD_CRON'),
      minTraits: this.get('PERSONA_MIN_TRAITS'),
      roleAggMinPersons: this.get('PERSONA_ROLE_AGG_MIN_PERSONS'),
      scheduledRebuildEnabled: this.get('EXECUTABLE_PERSONA_SCHEDULED_REBUILD_ENABLED'),
      thresholdTraitsCount: this.get('EXECUTABLE_PERSONA_THRESHOLD_TRAITS_COUNT'),
      minRebuildIntervalMinutes: this.get('EXECUTABLE_PERSONA_MIN_REBUILD_INTERVAL_MINUTES'),
    } as const;
  }

  get idle() {
    return {
      timeoutMinutes: this.resolveSync<number>(
        'idle.timeoutMinutes',
        'IDLE_MEETING_TIMEOUT_MINUTES',
        15,
      ),
      cron: this.resolveSync<string>('idle.cron', 'IDLE_MEETING_CRON', '*/1 * * * *'),
    } as const;
  }

  get meetingVisibilityEnabled(): boolean {
    return this.resolveSync<boolean>(
      'meeting.visibility.enabled',
      'MEETING_VISIBILITY_ENABLED',
      true,
    );
  }

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
      meetingUploadEnabled: this.resolveSync<boolean>(
        'meeting_upload.enabled',
        'MEETING_UPLOAD_ENABLED',
        true,
      ),
    } as const;
  }

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

  get processTemplate() {
    return {
      detectorBatchSize: Number(this.get('PROCESS_DETECTOR_BATCH_SIZE') ?? 10),
      detectorBatchTimeoutSeconds: Number(
        this.get('PROCESS_DETECTOR_BATCH_TIMEOUT_SECONDS') ?? 300,
      ),
      completenessCron: String(this.get('PROCESS_TEMPLATE_COMPLETENESS_CRON') ?? '0 3 * * *'),
      dedupeThreshold: Number(this.get('PROCESS_TEMPLATE_DEDUPE_THRESHOLD') ?? 0.85),
      crossFunctionalDetectorEnabled: this.get('CROSS_FUNCTIONAL_DETECTOR_ENABLED') !== false,
      crossFunctionalScoreThreshold: Number(this.get('CROSS_FUNCTIONAL_SCORE_THRESHOLD') ?? 0.5),
    } as const;
  }

  get admin() {
    return {
      bootstrapEmail: this.get('ADMIN_BOOTSTRAP_EMAIL'),
      sessionTtlSeconds: this.get('ADMIN_SESSION_TTL_SECONDS'),
    } as const;
  }

  get companyFoundation() {
    return {
      domainExpanderEnabled: this.get('DOMAIN_EXPANDER_ENABLED'),
      domainExpanderMinClusterSize: this.get('DOMAIN_EXPANDER_MIN_CLUSTER_SIZE'),
      domainExpanderMaxNewPerRun: this.get('DOMAIN_EXPANDER_MAX_NEW_PER_RUN'),
      maturityScorerEnabled: this.get('MATURITY_SCORER_ENABLED'),
    } as const;
  }

  get experiments() {
    return {
      autoStatusTransitionEnabled: this.get('EXPERIMENT_AUTO_STATUS_TRANSITION_ENABLED'),
      runningProbeThresholdDays: this.get('EXPERIMENT_RUNNING_PROBE_THRESHOLD_DAYS'),
    } as const;
  }

  get brandVoice() {
    return {
      extractorEnabled: this.get('BRAND_VOICE_EXTRACTOR_ENABLED'),
      minCorpusSize: this.get('BRAND_VOICE_MIN_CORPUS_SIZE'),
    } as const;
  }

  get roleMap() {
    return {
      builderEnabled: this.get('ROLE_MAP_BUILDER_ENABLED'),
      batchTimeoutSeconds: Number(this.get('ROLE_MAP_BATCH_TIMEOUT_SECONDS') ?? 300),
    } as const;
  }

  get betaOps() {
    return {
      dailyCheckInEnabled: this.get('DAILY_CHECKIN_ENABLED'),
      morningLocalHour: Number(this.get('DAILY_CHECKIN_MORNING_LOCAL_HOUR') ?? 9),
      eveningLocalHour: Number(this.get('DAILY_CHECKIN_EVENING_LOCAL_HOUR') ?? 18),
      operationsDashboardCacheTtlSeconds: Number(
        this.get('OPERATIONS_DASHBOARD_CACHE_TTL_SECONDS') ?? 300,
      ),
      sentimentEnabled: this.get('COO_SENTIMENT_ENABLED') !== false,
      checkinGraphIngestEnabled: this.get('CHECKIN_GRAPH_INGEST_ENABLED') !== false,
      weeklyDigestEnabled: this.get('COO_WEEKLY_DIGEST_ENABLED') !== false,
      weeklyDigestLocalHour: Number(this.get('COO_WEEKLY_DIGEST_LOCAL_HOUR') ?? 8),
      weeklyDigestLocalDay: Number(this.get('COO_WEEKLY_DIGEST_LOCAL_DAY') ?? 1),
      dailyDigestEnabled: this.get('COO_DAILY_DIGEST_ENABLED') !== false,
      dailyDigestHourUtc: Number(this.get('COO_DAILY_DIGEST_HOUR_UTC') ?? 22),
      commitmentFollowupEnabled: this.get('COMMITMENT_FOLLOWUP_ENABLED') !== false,
      commitmentFollowupLocalHour: Number(this.get('COMMITMENT_FOLLOWUP_LOCAL_HOUR') ?? 9),
      commitmentFallbackDueWorkdays: Number(this.get('COMMITMENT_FALLBACK_DUE_WORKDAYS') ?? 5),
      commitmentEscalationDays: Number(this.get('COMMITMENT_ESCALATION_DAYS') ?? 3),
      commitmentMaxRetries: Number(this.get('COMMITMENT_MAX_RETRIES') ?? 2),
    } as const;
  }

  get invites() {
    return {
      botUsername: String(this.get('KORA_BOT_USERNAME') ?? 'kora_bot').replace(/^@/, ''),
      ttlDays: Number(this.get('INVITE_TTL_DAYS') ?? 14),
      reminderDays: Number(this.get('INVITE_REMINDER_DAYS') ?? 7),
      magicLinkTtlMinutes: Number(this.get('MAGIC_LINK_TTL_MINUTES') ?? 15),
      magicLinkRateLimitPerHour: Number(this.get('MAGIC_LINK_RATE_LIMIT_PER_HOUR') ?? 5),
      inactiveBindingDays: Number(this.get('INACTIVE_BINDING_DAYS') ?? 30),
    } as const;
  }

  get proactive() {
    return {
      enabled: this.get('PROACTIVE_WATCHER_ENABLED') !== false,
      antiSpamTtlHours: Number(this.get('PROACTIVE_WATCHER_ANTI_SPAM_TTL_HOURS') ?? 24),
      rules: {
        decisionNoOwner: this.get('PROACTIVE_RULE_DECISION_NO_OWNER_ENABLED') !== false,
        insightNoMitigation: this.get('PROACTIVE_RULE_INSIGHT_NO_MITIGATION_ENABLED') !== false,
        experimentRunningTooLong:
          this.get('PROACTIVE_RULE_EXPERIMENT_RUNNING_TOO_LONG_ENABLED') !== false,
        processStaleReview: this.get('PROACTIVE_RULE_PROCESS_STALE_REVIEW_ENABLED') !== false,
        roleLowCompleteness: this.get('PROACTIVE_RULE_ROLE_LOW_COMPLETENESS_ENABLED') !== false,
        departmentNoDomain: this.get('PROACTIVE_RULE_DEPARTMENT_NO_DOMAIN_ENABLED') !== false,
        insightsSiloedInDomain:
          this.get('PROACTIVE_RULE_INSIGHTS_SILOED_IN_DOMAIN_ENABLED') !== false,
        planItemOverdue: this.get('PROACTIVE_RULE_PLAN_ITEM_OVERDUE_ENABLED') !== false,
      },
    } as const;
  }

  get voice() {
    return {
      ttsProvider: String(this.get('TTS_PROVIDER') ?? 'openai') as 'openai' | 'yandex',
      ttsVoice: String(this.get('TTS_VOICE') ?? 'alloy'),
      wsEnabled: this.get('VOICE_WS_ENABLED') !== false,
    } as const;
  }

  get concierge() {
    const prmShadowSampleRate = Math.min(
      Math.max(
        this.resolveSync<number>(
          'concierge.prmShadowSampleRate',
          'CONCIERGE_PRM_SHADOW_SAMPLE_RATE',
          1.0,
        ),
        0,
      ),
      1,
    );
    const loopbackBaseUrlRaw = (this.get('CONCIERGE_LOOPBACK_BASE_URL') as string | undefined)?.trim();
    let loopbackBaseUrl = 'http://127.0.0.1:3000';
    if (loopbackBaseUrlRaw) {
      try {
        void new URL(loopbackBaseUrlRaw);
        loopbackBaseUrl = loopbackBaseUrlRaw.replace(/\/+$/, '');
      } catch {}
    }
    return {
      enabled: this.resolveSync<boolean>('concierge.enabled', 'CONCIERGE_ENABLED', true),
      dailyMessagesLimit: this.resolveSync<number>(
        'concierge.dailyMessagesLimit',
        'CONCIERGE_DAILY_MESSAGES_LIMIT',
        100,
      ),
      monthlyMessagesLimit: this.resolveSync<number>(
        'concierge.monthlyMessagesLimit',
        'CONCIERGE_MONTHLY_MESSAGES_LIMIT',
        3000,
      ),
      sseHeartbeatSeconds: this.resolveSync<number>(
        'concierge.sseHeartbeatSeconds',
        'CONCIERGE_SSE_HEARTBEAT_SECONDS',
        15,
      ),
      dialogLayerEnabled: this.resolveSync<boolean>(
        'concierge.dialogLayerEnabled',
        'CONCIERGE_DIALOG_LAYER_ENABLED',
        true,
      ),
      preRetrievalTopK: this.resolveSync<number>(
        'concierge.preRetrievalTopK',
        'CONCIERGE_PRE_RETRIEVAL_TOP_K',
        12,
      ),
      preRetrievalTimeoutMs: this.resolveSync<number>(
        'concierge.preRetrievalTimeoutMs',
        'CONCIERGE_PRE_RETRIEVAL_TIMEOUT_MS',
        3000,
      ),
      prmShadowEnabled: this.resolveSync<boolean>(
        'concierge.prmShadowEnabled',
        'CONCIERGE_PRM_SHADOW_ENABLED',
        false,
      ),
      prmEnabled: this.resolveSync<boolean>('concierge.prmEnabled', 'CONCIERGE_PRM_ENABLED', false),
      prmTopK: this.resolveSync<number>('concierge.prmTopK', 'CONCIERGE_PRM_TOP_K', 3),
      prmShadowSampleRate,
      nativeToolsEnabled: this.resolveSync<boolean>(
        'concierge.nativeToolsEnabled',
        'CONCIERGE_NATIVE_TOOLS_ENABLED',
        true,
      ),
      loopbackBaseUrl,
    } as const;
  }

  get budget() {
    const rawThresholds = String(this.get('BUDGET_ALERT_THRESHOLD_PERCENTS') ?? '80,100');
    const thresholds = rawThresholds
      .split(',')
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0 && n <= 1000)
      .sort((a, b) => a - b);
    return {
      alertEnabled: this.get('BUDGET_ALERT_ENABLED') !== false,
      alertThresholdPercents: thresholds.length > 0 ? thresholds : [80, 100],
      currencyRateApiUrl: String(
        this.get('CURRENCY_RATE_API_URL') ?? 'https://www.cbr-xml-daily.ru/daily_json.js',
      ),
      currencyFallbackUsdRub: Number(this.get('CURRENCY_RATE_FALLBACK_USD_RUB') ?? 90),
      providerSmokeTestEnabled: this.get('PROVIDER_SMOKE_TEST_ENABLED') !== false,
      providerSmokeTestIntervalMinutes: Number(
        this.get('PROVIDER_SMOKE_TEST_INTERVAL_MINUTES') ?? 30,
      ),
      providerSmokeTestFailThreshold: Number(this.get('PROVIDER_SMOKE_TEST_FAIL_THRESHOLD') ?? 3),
      useProtocolAdapterRegistry: this.get('USE_PROTOCOL_ADAPTER_REGISTRY') === true,
    } as const;
  }

  get tracker() {
    return {
      webhookHmacPrefix: this.get('WEBHOOK_HMAC_PREFIX'),
      ingestQueue: this.get('TRACKER_INGEST_QUEUE'),
      idempotencyKeyTtlSeconds: this.get('IDEMPOTENCY_KEY_TTL_SECONDS'),
      webhookMaxRetries: this.get('TRACKER_WEBHOOK_MAX_RETRIES'),
      webhookRetryBackoffInitialMs: this.get('TRACKER_WEBHOOK_RETRY_BACKOFF_INITIAL_MS'),
      autoAcceptConfidenceThreshold: this.resolveSync<number>(
        'tracker.autoAcceptConfidenceThreshold',
        undefined,
        0.75,
      ),
      assignmentNotificationsEnabled: Boolean(this.get('ASSIGNMENT_NOTIFICATIONS_ENABLED') ?? true),
    } as const;
  }

  get dataClassPolicy() {
    const mode = this.get('DATACLASS_POLICY_ENFORCEMENT') as
      | 'off'
      | 'shadow'
      | 'enforce'
      | undefined;
    return {
      enforcement: mode ?? 'shadow',
      version: String(this.get('DATACLASS_POLICY_VERSION') ?? 'v1'),
      auditRequired: Boolean(this.get('DATACLASS_AUDIT_REQUIRED') ?? true),
      outboundGatingEnabled: Boolean(this.get('DATACLASS_OUTBOUND_GATING_ENABLED') ?? true),
    } as const;
  }

  get knowledgeAccess() {
    const mode = this.get('KNOWLEDGE_ACCESS_ENFORCEMENT') as
      | 'off'
      | 'shadow'
      | 'enforce'
      | undefined;
    return { enforcement: mode ?? 'off' } as const;
  }

  get confidenceCalibration() {
    return {
      enabled: Boolean(this.get('CONFIDENCE_CALIBRATION_ENABLED') ?? false),
      cron: String(this.get('CONFIDENCE_CALIBRATION_CRON') ?? '0 4 * * 0'),
    } as const;
  }

  get temporalProbe() {
    return {
      cron: String(this.get('TEMPORAL_PROBE_CRON') ?? '0 7 * * 1'),
      limitPerOrg: Number(this.get('TEMPORAL_PROBE_LIMIT_PER_ORG') ?? 50),
      escalateAfterWeeks: Number(this.get('TEMPORAL_PROBE_ESCALATE_AFTER_WEEKS') ?? 2),
    } as const;
  }

  get signalTypeStats() {
    return {
      cron: String(this.get('SIGNAL_TYPE_STATS_CRON') ?? '0 2 * * *'),
      driftSigmaThreshold: Number(this.get('SIGNAL_TYPE_DRIFT_SIGMA_THRESHOLD') ?? 3.0),
    } as const;
  }

  get push() {
    const publicKey = String(this.get('VAPID_PUBLIC_KEY') ?? '').trim();
    const privateKey = String(this.get('VAPID_PRIVATE_KEY') ?? '').trim();
    return {
      vapidPublicKey: publicKey.length > 0 ? publicKey : undefined,
      vapidPrivateKey: privateKey.length > 0 ? privateKey : undefined,
      vapidSubject: String(this.get('VAPID_SUBJECT') ?? 'mailto:noreply@kora.app'),
      maxFailures: Number(this.get('PUSH_MAX_FAILURES') ?? 5),
      isSendEnabled: publicKey.length > 0 && privateKey.length > 0,
    } as const;
  }

  get billing() {
    const provider = String(this.get('BILLING_PROVIDER') ?? 'manual') as 'tochka' | 'manual';
    const tochkaMode = String(this.get('TOCHKA_MODE') ?? 'sandbox') as 'sandbox' | 'production';
    const customDadataKey = String(this.get('DADATA_API_KEY') ?? '').trim();

    return {
      provider,
      features: {
        tochka: this.get('FEATURE_BILLING_TOCHKA') === true,
        cardRecurring: this.get('FEATURE_BILLING_CARD_RECURRING') === true,
        bankInvoice: this.get('FEATURE_BILLING_BANK_INVOICE') === true,
      },
      publicApiUrl: this.get('BILLING_PUBLIC_API_URL') as string | undefined,
      successRedirectUrl: this.get('BILLING_SUCCESS_REDIRECT_URL') as string | undefined,
      failRedirectUrl: this.get('BILLING_FAIL_REDIRECT_URL') as string | undefined,
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
        oauthConsentExpiresAt: this.get('TOCHKA_OAUTH_CONSENT_EXPIRES_AT') as string | undefined,
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

  get port(): number {
    return this.runtime.port;
  }

  async getDynamic<T>(key: string, envFallbackKey?: string, defaultValue?: T): Promise<T> {
    const reader = this.resolveAdminReader();
    if (reader) {
      try {
        const fromDb = await reader.get<T>(key);
        if (fromDb !== undefined && fromDb !== null) {
          return fromDb;
        }
      } catch (err) {
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
      const svc = this.moduleRef.get<DynamicAdminSettingsReader>(ADMIN_SETTINGS_READER_TOKEN, {
        strict: false,
      });
      this.adminReader = svc ?? null;
    } catch {
      this.adminReader = null;
    }
    return this.adminReader;
  }

  hydrateSync(entries: Iterable<[string, unknown]>): void {
    this.cacheMap.clear();
    for (const [k, v] of entries) {
      this.cacheMap.set(k, v);
    }
    this.resolveSourceLogged.clear();
  }

  applySync(key: string, value: unknown | undefined): void {
    if (value === undefined) {
      this.cacheMap.delete(key);
    } else {
      this.cacheMap.set(key, value);
    }
    for (const tag of Array.from(this.resolveSourceLogged)) {
      if (tag.startsWith(`${key}:`)) this.resolveSourceLogged.delete(tag);
    }
  }

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
    if (envFallbackKey !== undefined) {
      this.logSourceOnce(adminKey, 'env');
      return undefined as T;
    }
    throw new Error(
      `TypedConfigService.resolveSync: "${adminKey}" не найден ни в cache, ни в ENV, ни в defaultValue`,
    );
  }

  private logSourceOnce(_adminKey: string, _source: 'cache' | 'env' | 'default'): void {}

  get demo(): { referenceOrgId: string | null } {
    const id = this.get('ZDEMO_ORG_ID');
    return {
      referenceOrgId: typeof id === 'string' && id.length > 0 ? id : null,
    };
  }
}
