import { z } from 'zod';

const zBool = (def: boolean) =>
  z.preprocess((v) => {
    if (v === undefined || v === null || v === '') return def;
    if (typeof v === 'boolean') return v;
    const s = String(v).trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(s)) return true;
    if (['false', '0', 'no', 'off'].includes(s)) return false;
    return v;
  }, z.boolean());

const RuntimeSchema = z.object({
  NODE_ENV: z.enum(['production', 'development', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

const DatabaseSchema = z.object({
  DATABASE_URL: z.string().url(),
});

const RedisSchema = z.object({
  REDIS_URL: z.string().url(),
});

const AuthSchema = z.object({
  JWT_SESSION_SECRET: z.string().min(32, 'JWT_SESSION_SECRET должен быть минимум 32 символа'),
  JWT_DEEP_LINK_SECRET: z.string().min(32, 'JWT_DEEP_LINK_SECRET должен быть минимум 32 символа'),
  COOKIE_DOMAIN: z.string().min(1),
  COOKIE_STANDALONE_DOMAIN: z.string().min(1).optional(),
  PUBLIC_FRONTEND_URL: z.string().url(),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
  DEEP_LINK_TTL_SECONDS: z.coerce.number().int().positive().default(900),
});

const ArgonSchema = z.object({
  ARGON_MEMORY_KB: z.coerce.number().int().positive().default(19_456),
  ARGON_ITERATIONS: z.coerce.number().int().positive().default(2),
  ARGON_PARALLELISM: z.coerce.number().int().positive().default(1),
});

const MailSchema = z.object({
  MAIL_HOST: z.string().min(1).default('mail.hosting.reg.ru'),
  MAIL_PORT: z.coerce.number().int().positive().default(465),
  MAIL_SSL: zBool(true),
  MAIL_USERNAME: z.string().min(1).optional(),
  MAIL_PASSWORD: z.string().min(1).optional(),
  MAIL_FROM: z.string().email().default('noreply@crossmark.ru'),
  MAIL_FROM_NAME: z.string().default('Кора'),
  MAIL_DRY_RUN: zBool(false),
});

const LiveKitSchema = z.object({
  LIVEKIT_API_URL: z.string().url(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  LIVEKIT_WEBHOOK_API_KEY: z.string().min(1),
  LIVEKIT_WEBHOOK_API_SECRET: z.string().min(1),
  LIVEKIT_WEBHOOK_ACK_FIRST_ENABLED: zBool(false),
});

const TurnSchema = z.object({
  TURN_MODE: z.enum(['builtin', 'external']).default('builtin'),
  TURN_HOST: z.string().optional(),
  TURN_PORT: z.coerce.number().int().positive().optional(),
  TURN_USERNAME: z.string().optional(),
  TURN_PASSWORD: z.string().optional(),
  TURN_TLS: zBool(true),
});

const S3Schema = z.object({
  S3_ENDPOINT_URL: z.string().url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_PRESIGNED_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
});

const AnthropicSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().min(1).default('claude-sonnet-4-6'),
  ANTHROPIC_USE_PROXY: zBool(false),
  ANTHROPIC_PROXY_URL: z.string().url().default('https://proxy.agent-lia.ru'),
});

const LlmRouterSchema = z.object({
  LLM_ROUTER_DISPATCH_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  LLM_MAIN_REPORT_PRIMARY: z.enum(['minimax', 'deepseek']).default('deepseek'),
});

const VoxSchema = z.object({
  VOX_API_URL: z.string().url().default('https://vox.agent-lia.ru'),
  VOX_API_TOKEN: z.string().min(1),
  VOX_MODEL: z.string().min(1).default('v3_rnnt'),
  VOX_LANGUAGE: z.string().min(1).default('ru'),
  VOX_PUNCTUATION_MODE: z.string().min(1).default('pro'),
  VOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  VOX_POLL_MAX_ATTEMPTS: z.coerce.number().int().positive().default(180),
});

const OpenAiSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
});

const DeepSeekSchema = z.object({
  DEEPSEEK_API_KEY: z.string().min(1),
  DEEPSEEK_BASE_URL: z.string().url().default('https://api.deepseek.com/v1'),
  DEEPSEEK_DEFAULT_MODEL: z.string().min(1).default('deepseek-v4-flash'),
  LLM_DEEPSEEK_FORCE_TOOL_CHOICE_ENABLED: zBool(true),
});

const OllamaSchema = z.object({
  OLLAMA_BASE_URL: z.string().url().default('https://ollama.agent-lia.ru/v1'),
  OLLAMA_API_KEY: z.string().default(''),
});

const MiniMaxSchema = z.object({
  MINIMAX_API_KEY: z.string().min(1),
  MINIMAX_BASE_URL: z.string().url().default('https://api.minimax.io/anthropic'),
});

const GrsAiSchema = z.object({
  GRSAI_API_KEY: z.string().min(1),
  GRSAI_BASE_URL: z.string().url().default('https://grsaiapi.com'),
});

const KieSchema = z.object({
  KIE_API_KEY: z.string().min(1),
  KIE_BASE_URL: z.string().url().default('https://api.kie.ai'),
});

const ProxySchema = z.object({
  PROXY_BASE_URL: z.string().url().default('https://proxy.agent-lia.ru/v1'),
  PROXY_PREFIX: z.string().min(1).default('myFeedproxy3128'),
});

const EmbeddingsSchema = z.object({
  EMBEDDING_PROVIDER: z
    .enum(['openai-via-proxy', 'local', 'openai-direct'])
    .default('openai-via-proxy'),
  EMBEDDING_MODEL: z.string().min(1).default('text-embedding-3-small'),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),
  OPENAI_PROXY_API_KEY: z.string().optional(),
  OPENAI_PROXY_EMBEDDINGS_URL: z.string().url().default('https://proxy.agent-lia.ru/v1/embeddings'),
  EMBEDDING_FALLBACK_LOCAL_URL: z.string().url().optional(),
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().positive().default(100),
  EMBEDDING_CHUNK_TARGET_TOKENS: z.coerce.number().int().positive().default(400),
  EMBEDDING_CHUNK_OVERLAP_TOKENS: z.coerce.number().int().positive().default(50),
});

const CrossmarkSchema = z.object({
  CROSSMARK_HMAC_TIMESTAMP_WINDOW_SECONDS: z.coerce.number().int().positive().default(300),
});

const RetentionSchema = z.object({
  DEFAULT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  RETENTION_CRON: z.string().min(1).default('0 * * * *'),
  SOFT_DELETE_GRACE_DAYS: z.coerce.number().int().positive().default(30),
  WEBHOOK_DELIVERY_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  SHARE_VIEW_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  API_ACCESS_LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  RETENTION_SWEEP_BATCH_SIZE: z.coerce.number().int().positive().default(500),
  RETENTION_RAW_EVENTS_ENABLED: zBool(false),
  RETENTION_AUDIT_ENABLED: zBool(false),
  RETENTION_CHAT_ENABLED: zBool(true),
  RETENTION_BLOCKS_ENABLED: zBool(false),
});

const IdleSchema = z.object({
  IDLE_MEETING_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(15),
  IDLE_MEETING_CRON: z.string().min(1).default('*/1 * * * *'),
});

const RecordingReliabilitySchema = z.object({
  RECORDING_TRACK_RECONCILE_ENABLED: zBool(true),
  RECORDING_FASTSTART_ENABLED: zBool(true),
  RECORDING_FASTSTART_MIN_BYTES: z.coerce.number().int().nonnegative().default(52_428_800),
  RECORDING_COMPOSITE_RECONCILE_ENABLED: zBool(true),
  MEETING_UPLOAD_ENABLED: zBool(true),
});

const QuotasSchema = z.object({
  MAX_PARTICIPANTS_PER_MEETING: z.coerce.number().int().positive().default(10),
  MAX_MEETING_DURATION_HOURS: z.coerce.number().int().positive().default(8),
});

const AiChatQuotaSchema = z.object({
  AI_CHAT_DAILY_LIMIT_ADMIN: z.coerce.number().int().positive().default(50),
  AI_CHAT_DAILY_LIMIT_MEMBER: z.coerce.number().int().positive().default(20),
  AI_CHAT_ADMIN_ROLES: z.string().default('owner,admin,coo'),
});

const AdminSchema = z.object({
  ADMIN_BOOTSTRAP_EMAIL: z.string().email().optional(),
  ADMIN_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(43_200),
});

const WebhooksOutSchema = z.object({
  WEBHOOK_SECRETS_ENCRYPTION_KEY: z
    .string()
    .min(1)
    .refine((v) => {
      try {
        return Buffer.from(v, 'base64').length === 32;
      } catch {
        return false;
      }
    }, 'WEBHOOK_SECRETS_ENCRYPTION_KEY должен быть base64 от 32 байт (256 бит)'),
  WEBHOOK_DELIVERY_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().positive().default(8),
  WEBHOOK_EGRESS_ALLOWED_HOSTS: z.string().default(''),
});

const WorkspaceLimitsSchema = z.object({
  CLIP_MAX_DURATION_SECONDS: z.coerce.number().int().positive().default(300),
  EXPORT_ZIP_MAX_MEETINGS: z.coerce.number().int().positive().default(100),
  EXPORT_ZIP_MAX_SIZE_BYTES: z.coerce.number().int().positive().default(21_474_836_480),

  MAX_API_KEYS_PER_USER: z.coerce.number().int().positive().default(10),
  MAX_WEBHOOK_SUBSCRIPTIONS_PER_USER: z.coerce.number().int().positive().default(20),
  MAX_DESTINATIONS_PER_USER: z.coerce.number().int().positive().default(20),
  MAX_TAGS_PER_USER: z.coerce.number().int().positive().default(50),
  MAX_USER_TEMPLATES_PER_USER: z.coerce.number().int().positive().default(20),

  MAX_CHAT_REQUESTS_PER_DAY: z.coerce.number().int().positive().default(200),
  MAX_CHAT_TOKENS_PER_DAY: z.coerce.number().int().positive().default(2_000_000),
  MAX_RENDER_JOBS_PER_HOUR: z.coerce.number().int().positive().default(10),
  MAX_BULK_EXPORTS_PER_DAY: z.coerce.number().int().positive().default(5),
  MAX_REGENERATE_PER_MEETING_PER_DAY: z.coerce.number().int().positive().default(5),
  MAX_MEETINGS_CREATED_PER_DAY_VIA_API: z.coerce.number().int().positive().default(100),
  MAX_EMBEDDING_TOKENS_PER_MONTH_PER_USER: z.coerce.number().int().positive().default(10_000_000),
  MAX_GOAL_RECOMPUTE_PER_DAY: z.coerce.number().int().positive().default(5),

  MAX_HIGHLIGHTS_PER_MEETING: z.coerce.number().int().positive().default(50),
  MAX_BULK_OPERATION_IDS: z.coerce.number().int().positive().default(200),
  MAX_CHAT_MESSAGE_CHARS: z.coerce.number().int().positive().default(8_000),

  MAX_CARDS_PER_USER: z.coerce.number().int().positive().default(500),
  MAX_CARD_ROLLUPS_PER_DAY: z.coerce.number().int().positive().default(100),

  MAX_ROOM_MESSAGE_CHARS: z.coerce.number().int().positive().default(2_000),
});

const AiFeatureFlagsSchema = z.object({
  INCLUDE_ROOM_CHAT_IN_AI: zBool(true),
  TRANSCRIPT_CLEANING_LLM_REFINE_ENABLED: zBool(true),
  BEHAVIOR_METRICS_LLM_REFINE_ENABLED: zBool(false),
  PROMPT_INJECTION_GUARD_ENABLED: zBool(true),
  SUMMARY_AGENT_ENABLED: zBool(true),
  CLIENT_PROTOCOL_ENABLED: zBool(true),
  DOC_COMPILER_ENABLED: zBool(true),
  REGULATION_GATE_STRICT_ENABLED: zBool(true),
  ASSIGNMENT_NOTIFICATIONS_ENABLED: zBool(true),
});

const HashingSchema = z.object({
  IP_HASH_DAILY_SALT: z.string().min(16).default('change-me-in-prod-please-32chars'),
});

const IngestSchema = z.object({
  INGEST_INTERNAL_TOKEN: z.string().default(''),
});

const CryptoSchema = z.object({
  CRYPTO_MASTER_KEY: z.string().default(''),
  PUBLIC_HOST_URL: z.string().url().optional(),
});

const DocumentIngestSchema = z.object({
  DOCUMENT_PARSE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  DOCUMENT_MAX_SIZE_MB: z.coerce.number().int().positive().default(50),
  DOCUMENT_INLINE_THRESHOLD_MB: z.coerce.number().int().positive().default(10),
  S3_BUCKET_DOCUMENTS: z.string().default(''),
});

const ExtractionSchema = z.object({
  EXTRACTION_ENABLE_TOP_LEVEL: z.coerce.boolean().default(false),
  EXTRACTION_TYPED_ENTITY_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.5),
});

const EmailFetchSchema = z.object({
  EMAIL_FETCH_ENABLED: zBool(false),
  EMAIL_FETCH_CRON: z.string().min(1).default('*/5 * * * *'),
  EMAIL_FETCH_MAX_PER_RUN: z.coerce.number().int().positive().default(50),

  MAIL_INBOX_ENABLED: zBool(false),
  MAIL_INBOX_DOMAIN: z.string().min(1).default('inbox.kora.app'),
  MAIL_INBOX_IMAP_HOST: z.string().optional(),
  MAIL_INBOX_IMAP_PORT: z.coerce.number().int().positive().default(993),
  MAIL_INBOX_IMAP_USER: z.string().optional(),
  MAIL_INBOX_IMAP_PASS: z.string().optional(),
  MAIL_INBOX_IMAP_TLS: zBool(true),
  MAIL_INBOX_IMAP_FOLDER: z.string().min(1).default('INBOX'),
  MAIL_INBOX_POLL_CRON: z.string().min(1).default('*/2 * * * *'),
  MAIL_INBOX_MAX_PER_RUN: z.coerce.number().int().positive().default(50),
});

const KnowledgeCoreSchema = z.object({
  DISTILL_MERGE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.92),
  DISTILL_DEBOUNCE_MS: z.coerce.number().int().positive().default(30_000),
  DISTILL_KNN_TOP_K: z.coerce.number().int().positive().default(5),
  ENTITY_MERGE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.88),
  ENTITY_RESOLVER_CRON: z.string().min(1).default('*/5 * * * *'),
  REGULATION_CONSOLIDATOR_CRON: z.string().min(1).default('*/30 * * * *'),
  BLOCK_INGEST_WINDOW_SEGMENTS: z.coerce.number().int().positive().default(5),
  BLOCK_INGEST_MAX_TOKENS_PER_SEGMENT: z.coerce.number().int().positive().default(2000),
  SEARCH_COSINE_WEIGHT: z.coerce.number().min(0).max(1).default(0.7),
  SEARCH_BM25_WEIGHT: z.coerce.number().min(0).max(1).default(0.3),

  LINK_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.5),
  LINKER_MIN_BLOCKS: z.coerce.number().int().positive().default(3),
  LINK_KNN_TOP_K: z.coerce.number().int().positive().default(10),
  REFRAMING_CRON: z.string().min(1).default('0 3 * * *'),
  BLOCK_DYNAMIC_SCORE_DECAY_DAYS: z.coerce.number().int().positive().default(90),
  ENTITY_GRAPH_BUILDER_CRON: z.string().min(1).default('0 * * * *'),
  ENTITY_GRAPH_MIN_COMENTIONS: z.coerce.number().int().positive().default(2),
  GRAPH_AGE_ENABLED: zBool(true),

  THEME_CLUSTERER_CRON: z.string().min(1).default('15 * * * *'),
  THEME_CLUSTERING_MIN_BLOCKS: z.coerce.number().int().positive().default(10),
  THEME_CLUSTER_MIN_SIZE: z.coerce.number().int().positive().default(3),
  THEME_COSINE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.78),
  CARD_ROLLUP_V2_DEBOUNCE_MS: z.coerce.number().int().positive().default(60_000),

  DASHBOARD_THEME_SILENCE_ENABLED: zBool(true),
  DASHBOARD_THEME_SILENCE_WEEKS: z.coerce.number().int().positive().default(3),

  USE_APPOINTMENT_FOR_PERSON_ROLES: zBool(false),

  KNOWLEDGE_CORE_V2_AGENTS_ENABLED: zBool(false),
  MEETING_ANALYZE_V2_CRON: z.string().min(1).default('*/10 * * * *'),
  MEETING_ANALYZE_V2_DEBOUNCE_MS: z.coerce.number().int().positive().default(120_000),

  MEETING_REPORT_FAST_ENABLED: zBool(true),

  REPORT_INGEST_ENABLED: zBool(true),

  MESSAGE_BRIDGE_ENABLED: zBool(true),

  CHAT_ENABLED: zBool(true),

  CHAT_INGEST_ENABLED: zBool(true),

  CHAT_PUSH_ENABLED: zBool(true),

  EXTERNAL_CHAT_ENABLED: zBool(true),

  HUDDLES_ENABLED: zBool(true),

  CHAT_V2_ENABLED: zBool(false),
  CHAT_V2_TOP_BLOCKS: z.coerce.number().int().positive().default(12),
  CHAT_V2_GRAPH_HOPS: z.coerce.number().int().min(0).max(2).default(1),

  CHAT_V2_HISTORY_MESSAGES: z.coerce.number().int().min(0).max(20).default(6),
  CHAT_V2_CONVERSATION_TTL_DAYS: z.coerce.number().int().positive().default(90),
  CHAT_V2_CLEANUP_CRON: z.string().min(1).default('0 3 * * 0'),
  CHAT_V2_DEFAULT_MODE: z.enum(['factual', 'synthetic', 'clone_style']).default('synthetic'),
  CHAT_V2_STREAMING_ENABLED: zBool(true),

  BITEMPORAL_ENABLED: zBool(true),
  BITEMPORAL_SUPERSEDE_ENABLED: zBool(true),
  BITEMPORAL_FACT_SIGNAL_TYPES: z
    .string()
    .default('fact,commitment,commitment_status,plan_item,done_item,client_request'),

  FACT_SUPERSEDE_COSINE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),
  FACT_SUPERSEDE_KNN_TOP_K: z.coerce.number().int().positive().default(5),
  FACT_SUPERSEDE_COST_ALERT_PCT: z.coerce.number().min(0).max(100).default(5),

  ENTITY_INGEST_RESOLVE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.95),
  ENTITY_INGEST_RESOLVE_CACHE_TTL_S: z.coerce.number().int().positive().default(3600),

  BI_TEMPORAL_EDGES_ENABLED: zBool(true),

  MULTI_AGENT_DEBATE_ENABLED: zBool(false),
  DEBATE_DEFAULT_N: z.coerce.number().int().positive().default(3),
  DEBATE_DEFAULT_ROUNDS: z.coerce.number().int().positive().default(1),
  DEBATE_ROUND2_ENABLED: zBool(false),
  DEBATE_COST_CAP_USD_PER_RUN: z.coerce.number().nonnegative().default(0.05),

  PROJECTION_REBUILD_DEBOUNCE_MS: z.coerce.number().int().positive().default(300_000),
});

const ShareSchema = z.object({
  SHARE_TOKEN_LENGTH_BYTES: z.coerce.number().int().min(16).default(24),
  SHARE_DEFAULT_EXPIRATION_DAYS: z.coerce.number().int().positive().default(7),
  SHARE_ALLOWED_EXPIRATION_DAYS: z
    .string()
    .default('1,7,14')
    .transform((v) =>
      v
        .split(',')
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
});

const RouterSchema = z.object({
  ROUTER_DISPATCH_CONCURRENCY: z.coerce.number().int().positive().default(4),
  ROUTER_MAX_SPECIALISTS_PER_BLOCK: z.coerce.number().int().positive().default(4),
  SPECIALISTS_COMBINED_ENABLED: z.coerce.boolean().default(true),
  SPECIALISTS_COMBINED_DELAY_MS: z.coerce.number().int().nonnegative().default(90_000),
  ROUTER_FALLBACK_NEGATIVE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  ROUTER_LLM_FALLBACK_ENABLED: zBool(false),
  ROUTER_FALLBACK_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
});

const ConciergeSchema = z.object({
  CONCIERGE_ENABLED: zBool(true),
  CONCIERGE_DIALOG_LAYER_ENABLED: zBool(true),
  CONCIERGE_PRM_SHADOW_ENABLED: zBool(false),
  CONCIERGE_PRM_ENABLED: zBool(false),
  CONCIERGE_NATIVE_TOOLS_ENABLED: zBool(true),
  CONCIERGE_PRM_TOP_K: z.coerce.number().int().positive().default(3),
  CONCIERGE_PRM_SHADOW_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1.0),
  CONCIERGE_DAILY_MESSAGES_LIMIT: z.coerce.number().int().positive().default(100),
  CONCIERGE_MONTHLY_MESSAGES_LIMIT: z.coerce.number().int().positive().default(3000),
  CONCIERGE_SSE_HEARTBEAT_SECONDS: z.coerce.number().int().positive().default(15),
  CONCIERGE_PRE_RETRIEVAL_TOP_K: z.coerce.number().int().positive().default(12),
  CONCIERGE_PRE_RETRIEVAL_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  CONCIERGE_LOOPBACK_BASE_URL: z.string().optional(),
});

const OrchestratorSchema = z.object({
  ORCHESTRATOR_ENABLED: zBool(false),
  ORCHESTRATOR_MAX_SUBAGENTS_PER_RUN: z.coerce.number().int().positive().default(5),
  ORCHESTRATOR_RUN_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(15),
});

const WorkerKnobsSchema = z.object({
  AXIS_CLASSIFY_ENABLED: zBool(true),
  ROLE_PROFILE_MIN_BLOCKS: z.coerce.number().int().positive().default(5),
  CONSISTENCY_CHECKER_DEDUP_TTL_SECONDS: z.coerce.number().int().positive().default(14_400),
  CONSISTENCY_CHECKER_ENABLED: zBool(true),
  COMPLETENESS_SCANNER_ENABLED: zBool(true),
  GOAL_ALIGNMENT_LOW_ENABLED: zBool(true),
  TELEGRAM_DIGEST_HOUR_LOCAL: z.coerce.number().int().min(0).max(23).default(9),
});

const ConversationalSchema = z.object({
  CONVERSATIONAL_OUTBOUND_CONCURRENCY: z.coerce.number().int().positive().default(4),
  CONVERSATIONAL_LINK_CODE_TTL_SEC: z.coerce.number().int().positive().default(600),
  CONVERSATIONAL_QUIET_HOURS_DEFAULT: z.string().default('22:00-08:00'),
  CONVERSATIONAL_RATE_LIMIT_DEFAULT_PER_HOUR: z.coerce.number().int().positive().default(10),
  CONVERSATIONAL_EMAIL_FROM_DEFAULT: z.string().default(''),
  CONVERSATIONAL_MAX_DELIVERY_ATTEMPTS: z.coerce.number().int().positive().default(5),
});

const TelegramBotChannelSchema = z.object({
  TELEGRAM_BOT_API_BASE: z.string().url().default('https://api.telegram.org'),
  TELEGRAM_BOT_GLOBAL_RPS: z.coerce.number().int().positive().default(25),
});

const PushSchema = z.object({
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:noreply@kora.app'),
  PUSH_MAX_FAILURES: z.coerce.number().int().positive().default(5),

  APNS_KEY_ID: z.string().optional(),
  APNS_TEAM_ID: z.string().optional(),
  APNS_PRIVATE_KEY: z.string().optional(),
  APNS_BUNDLE_ID: z.string().optional(),
  APNS_USE_SANDBOX: zBool(false),

  FCM_PROJECT_ID: z.string().optional(),
  FCM_CLIENT_EMAIL: z.string().optional(),
  FCM_PRIVATE_KEY: z.string().optional(),

  RUSTORE_PROJECT_ID: z.string().optional(),
  RUSTORE_SERVICE_TOKEN: z.string().optional(),
});

const TelegramProxySchema = z.object({
  TELEGRAM_PROXY_ENABLED: zBool(true),
  TELEGRAM_PROXY_API_BASE: z.string().url().default('https://telegram.crossmark.ru'),
  TELEGRAM_PROXY_FILE_BASE: z.string().url().default('https://telegram.crossmark.ru'),
  TELEGRAM_PROXY_TOKEN: z.string().min(1).optional(),
  TELEGRAM_PROXY_REQUEST_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(15_000),
  TELEGRAM_PROXY_HEALTH_INTERVAL_SEC: z.coerce.number().int().nonnegative().default(30),
  TELEGRAM_PROXY_PING_TIMEOUT_SEC: z.coerce.number().int().positive().default(5),
});

const MaxBotChannelSchema = z.object({
  MAX_BOT_API_BASE: z.string().url().default('https://platform-api.max.ru'),
  MAX_BOT_GLOBAL_RPS: z.coerce.number().int().positive().default(25),
  BOT_VOICE_ENABLED: zBool(true),
  BOT_DOCUMENT_ENABLED: zBool(true),
  BOT_INTENT_CLASSIFIER_ENABLED: zBool(true),
  ASSISTANT_CHANNEL_ROUTING_ENABLED: zBool(true),
  ASSISTANT_INBOUND_ASYNC_ENABLED: zBool(true),
  CHATBOX_API_BASE_URL: z.string().url().default('https://app.agent-lia.ru'),
  BITRIX_CLIENT_ID: z.string().optional(),
  BITRIX_CLIENT_SECRET: z.string().optional(),
  BITRIX_OAUTH_BASE_URL: z.string().url().default('https://oauth.bitrix.info'),
});

const CurationSchema = z.object({
  CURATION_AUTO_THRESHOLD_DEFAULT: z.coerce.number().min(0).max(1).default(0.85),
  CURATION_DEEP_REVIEW_THRESHOLD_DEFAULT: z.coerce.number().min(0).max(1).default(0.6),
  CURATION_CRITICAL_TYPES_DEFAULT: z
    .string()
    .default('regulation,process,decision')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  CURATION_ITEM_EXPIRY_DAYS: z.coerce.number().int().positive().default(30),
  CARD_STALE_DETECTOR_CRON: z.string().min(1).default('0 4 * * *'),
  CARD_STALE_MONTHS_THRESHOLD: z.coerce.number().int().positive().default(6),
  CARD_STALE_DYNAMIC_SCORE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.3),
});

const KnowledgeCloneSchema = z.object({
  KNOWLEDGE_CLONE_REBUILD_CRON: z.string().min(1).default('0 */6 * * *'),
  KNOWLEDGE_CLONE_LOOKBACK_MONTHS: z.coerce.number().int().positive().default(12),
  KNOWLEDGE_CLONE_DEBOUNCE_MS: z.coerce.number().int().positive().default(60_000),
  KNOWLEDGE_CLONE_MIN_BLOCKS_FOR_PROFILE: z.coerce.number().int().positive().default(10),
  KNOWLEDGE_CLONE_EMBEDDING_FALLBACK_THRESHOLD: z.coerce.number().int().positive().default(5),
  KNOWLEDGE_CLONE_MIN_MATCH_SCORE: z.coerce.number().default(1.0),
});

const InsightsSchema = z.object({
  INSIGHT_CLUSTER_THRESHOLD: z.coerce.number().min(0).max(1).default(0.78),
  INSIGHT_CLUSTER_CRON: z.string().min(1).default('0 */6 * * *'),
  INSIGHT_FREQUENCY_WINDOW_DAYS: z.coerce.number().int().positive().default(30),
  INSIGHT_SPIKE_RATIO: z.coerce.number().positive().default(3.0),
});

const IdeasSchema = z.object({
  IDEA_CLUSTER_THRESHOLD: z.coerce.number().min(0).max(1).default(0.8),
  IDEA_CLUSTERER_CRON: z.string().min(1).default('30 */4 * * *'),
  IDEA_MIN_SUPPORTERS_FOR_CLUSTER: z.coerce.number().int().positive().default(2),
});

const ProbeSchema = z.object({
  PROBE_DEDUP_TTL_HOURS: z.coerce.number().int().positive().default(72),
  PROBE_RATE_LIMIT_PER_USER_PER_HOUR: z.coerce.number().int().positive().default(5),
  PROBE_RATE_LIMIT_PER_USER_PER_DAY: z.coerce.number().int().positive().default(20),
  PROBE_EXPIRY_DAYS: z.coerce.number().int().positive().default(14),
  PROBE_PRIORITY_REFRESH_CRON: z.string().min(1).default('*/15 * * * *'),
  PROBE_QUIET_HOURS_DEFAULT_TZ_OFFSET_MIN: z.coerce.number().int().default(180),
  PROBE_COLD_START_MODE_HOURS: z.coerce.number().int().min(0).default(24),
  PROBE_RESPONSE_CLASSIFY_ENABLED: zBool(true),
  PROBE_SUBJECT_ADDRESSING_ENABLED: zBool(true),
  PROBE_VOICE_INPUT_ENABLED: zBool(true),
  PROBE_RESPONSE_CLASSIFY_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.5),
});

const SkillSchema = z.object({
  SKILL_MIN_OBSERVATIONS: z.coerce.number().int().positive().default(5),
  SKILL_TRAIT_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),
  SKILL_LOOKBACK_MONTHS: z.coerce.number().int().positive().default(12),
  SKILL_DECAY_MONTHS: z.coerce.number().int().positive().default(6),
  SKILL_ARCHIVE_MONTHS: z.coerce.number().int().positive().default(12),
  SKILL_RECALIBRATE_CRON: z.string().min(1).default('0 5 * * *'),
  SKILL_MANAGER_DIGEST_CRON: z.string().min(1).default('0 9 * * MON'),
  SKILL_REBUILD_DEBOUNCE_MS: z.coerce.number().int().positive().default(60_000),
  CLONE_ASK_PER_USER_PER_DAY: z.coerce.number().int().positive().default(20),
  CLONE_TOPIC_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.7),
  CLONE_TOPIC_MIN_BLOCKS: z.coerce.number().int().positive().default(2),
  CLONE_RESPOND_GROUNDING_ENABLED: zBool(true),
  ROLE_PRINCIPLE_SYNTHESIS_ENABLED: zBool(true),
  VALUE_MOTIVATION_DETECT_ENABLED: zBool(true),
  PROCESS_MARKER_DETECT_ENABLED: zBool(true),
  CDM_INTERVIEW_ENABLED: zBool(true),
  PERSONA_LAYER_VALIDATION_ENABLED: zBool(true),
  PERSONA_REBUILD_TRAIT_DELTA_THRESHOLD: z.coerce.number().int().positive().default(2),
  PERSONA_REBUILD_MAX_AGE_HOURS: z.coerce.number().int().positive().default(48),
  CLONE_CONCEPT_MATCH_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),
  CLONE_CONCEPT_MERGE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.92),
  CLONE_CONCEPT_ARCHIVE_AFTER_MONTHS: z.coerce.number().int().positive().default(6),

  CLONE_V2_ENABLED: zBool(false),
});

const ProcessTemplateSchema = z.object({
  PROCESS_DETECTOR_BATCH_SIZE: z.coerce.number().int().positive().default(10),
  PROCESS_DETECTOR_BATCH_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(300),
  PROCESS_TEMPLATE_COMPLETENESS_CRON: z.string().min(1).default('0 3 * * *'),
  PROCESS_TEMPLATE_DEDUPE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),
  CROSS_FUNCTIONAL_DETECTOR_ENABLED: zBool(true),
  CROSS_FUNCTIONAL_SCORE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),
});

const DialogLayerSchema = z.object({
  DIALOG_LAYER_ENABLED: zBool(true),
  ANSWER_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
  RETRIEVAL_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(3_600),
  SUMMARIZER_MESSAGE_THRESHOLD: z.coerce.number().int().positive().default(12),
  MULTI_QUERY_EXPANSION_ENABLED: zBool(true),
  QUERY_PLAN_EXTRACTION_ENABLED: zBool(true),
  DIALOG_SUMMARIZER_CRON: z.string().min(1).default('*/30 * * * *'),
  DIALOG_SUMMARIZER_KEEP_LAST: z.coerce.number().int().positive().default(6),
  DIALOG_SUMMARIZER_STALENESS_HOURS: z.coerce.number().int().positive().default(12),
});

const _ExperimentSchema = z.object({});

const PersonaSchema = z.object({
  PERSONA_BUILD_CRON: z.string().min(1).default('0 6 * * SUN'),
  PERSONA_MIN_TRAITS: z.coerce.number().int().positive().default(3),
  PERSONA_ROLE_AGG_MIN_PERSONS: z.coerce.number().int().positive().default(2),
  EXECUTABLE_PERSONA_SCHEDULED_REBUILD_ENABLED: zBool(true),
  EXECUTABLE_PERSONA_THRESHOLD_TRAITS_COUNT: z.coerce.number().int().positive().default(3),
  EXECUTABLE_PERSONA_MIN_REBUILD_INTERVAL_MINUTES: z.coerce.number().int().positive().default(60),

  DOMAIN_EXPANDER_ENABLED: zBool(true),
  DOMAIN_EXPANDER_MIN_CLUSTER_SIZE: z.coerce.number().int().positive().default(10),
  DOMAIN_EXPANDER_MAX_NEW_PER_RUN: z.coerce.number().int().positive().default(5),
  MATURITY_SCORER_ENABLED: zBool(true),

  BRAND_VOICE_EXTRACTOR_ENABLED: zBool(true),
  BRAND_VOICE_MIN_CORPUS_SIZE: z.coerce.number().int().positive().default(5),

  EXPERIMENT_AUTO_STATUS_TRANSITION_ENABLED: zBool(true),
  EXPERIMENT_RUNNING_PROBE_THRESHOLD_DAYS: z.coerce.number().int().positive().default(30),
});

const BetaOpsSchema = z.object({
  DAILY_CHECKIN_ENABLED: zBool(true),
  DAILY_CHECKIN_MORNING_LOCAL_HOUR: z.coerce.number().int().min(0).max(23).default(9),
  DAILY_CHECKIN_EVENING_LOCAL_HOUR: z.coerce.number().int().min(0).max(23).default(18),
  OPERATIONS_DASHBOARD_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  COO_SENTIMENT_ENABLED: zBool(true),
  CHECKIN_GRAPH_INGEST_ENABLED: zBool(true),
  COO_WEEKLY_DIGEST_ENABLED: zBool(true),
  COO_WEEKLY_DIGEST_LOCAL_HOUR: z.coerce.number().int().min(0).max(23).default(8),
  COO_WEEKLY_DIGEST_LOCAL_DAY: z.coerce.number().int().min(0).max(6).default(1),

  COO_DAILY_DIGEST_ENABLED: z.coerce.boolean().default(true),
  COO_DAILY_DIGEST_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(22),

  COO_MONTHLY_DIGEST_ENABLED: zBool(true),
  COO_MONTHLY_DIGEST_LOCAL_HOUR: z.coerce.number().int().min(0).max(23).default(6),

  COMMITMENT_FOLLOWUP_ENABLED: zBool(true),
  COMMITMENT_FOLLOWUP_LOCAL_HOUR: z.coerce.number().int().min(0).max(23).default(9),
  COMMITMENT_FALLBACK_DUE_WORKDAYS: z.coerce.number().int().positive().default(5),
  COMMITMENT_ESCALATION_DAYS: z.coerce.number().int().positive().default(3),
  COMMITMENT_MAX_RETRIES: z.coerce.number().int().positive().default(2),

  TTS_PROVIDER: z.string().min(1).default('openai'),
  TTS_VOICE: z.string().min(1).default('alloy'),
  VOICE_WS_ENABLED: zBool(true),

  PROACTIVE_WATCHER_ENABLED: zBool(true),
  PROACTIVE_WATCHER_ANTI_SPAM_TTL_HOURS: z.coerce.number().int().positive().default(24),
  PROACTIVE_RULE_DECISION_NO_OWNER_ENABLED: zBool(true),
  PROACTIVE_RULE_INSIGHT_NO_MITIGATION_ENABLED: zBool(true),
  PROACTIVE_RULE_EXPERIMENT_RUNNING_TOO_LONG_ENABLED: zBool(true),
  PROACTIVE_RULE_PROCESS_STALE_REVIEW_ENABLED: zBool(true),
  PROACTIVE_RULE_ROLE_LOW_COMPLETENESS_ENABLED: zBool(true),
  PROACTIVE_RULE_DEPARTMENT_NO_DOMAIN_ENABLED: zBool(true),
  PROACTIVE_RULE_INSIGHTS_SILOED_IN_DOMAIN_ENABLED: zBool(true),
  PROACTIVE_RULE_PLAN_ITEM_OVERDUE_ENABLED: zBool(true),

  KORA_BOT_USERNAME: z.string().min(1).default('kora_bot'),
  INVITE_TTL_DAYS: z.coerce.number().int().positive().default(14),
  INVITE_REMINDER_DAYS: z.coerce.number().int().positive().default(7),
  MAGIC_LINK_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  MAGIC_LINK_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(5),
  INACTIVE_BINDING_DAYS: z.coerce.number().int().positive().default(30),
});

const BudgetSchema = z.object({
  BUDGET_ALERT_ENABLED: zBool(true),
  BUDGET_ALERT_THRESHOLD_PERCENTS: z.string().default('80,100'),
  CURRENCY_RATE_API_URL: z.string().url().default('https://www.cbr-xml-daily.ru/daily_json.js'),
  CURRENCY_RATE_FALLBACK_USD_RUB: z.coerce.number().positive().default(90),
  PROVIDER_SMOKE_TEST_ENABLED: zBool(true),
  PROVIDER_SMOKE_TEST_INTERVAL_MINUTES: z.coerce.number().int().positive().default(30),
  PROVIDER_SMOKE_TEST_FAIL_THRESHOLD: z.coerce.number().int().positive().default(3),
  USE_PROTOCOL_ADAPTER_REGISTRY: zBool(false),
});

const TrackerSchema = z.object({
  WEBHOOK_HMAC_PREFIX: z.string().min(1).default('kora_wh_'),
  TRACKER_INGEST_QUEUE: z.string().min(1).default('core.raw-events'),
  SUPPORT_DESK_ENABLED: zBool(true),
  SUPPORT_CURATOR_ENABLED: zBool(true),
  MEETING_VISIBILITY_ENABLED: zBool(true),
  IDEMPOTENCY_KEY_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
  TRACKER_WEBHOOK_MAX_RETRIES: z.coerce.number().int().positive().default(5),
  TRACKER_WEBHOOK_RETRY_BACKOFF_INITIAL_MS: z.coerce.number().int().positive().default(60_000),

  DATACLASS_POLICY_ENFORCEMENT: z.enum(['off', 'shadow', 'enforce']).default('shadow'),
  DATACLASS_POLICY_VERSION: z.string().min(1).default('v1'),
  KNOWLEDGE_ACCESS_ENFORCEMENT: z.enum(['off', 'shadow', 'enforce']).default('off'),
  DATACLASS_AUDIT_REQUIRED: z.coerce.boolean().default(true),
  DATACLASS_OUTBOUND_GATING_ENABLED: z.coerce.boolean().default(true),

  CONFIDENCE_CALIBRATION_ENABLED: z.coerce.boolean().default(false),
  CONFIDENCE_CALIBRATION_CRON: z.string().min(1).default('0 4 * * 0'),

  TEMPORAL_PROBE_CRON: z.string().min(1).default('0 7 * * 1'),
  TEMPORAL_PROBE_LIMIT_PER_ORG: z.coerce.number().int().positive().default(50),
  TEMPORAL_PROBE_ESCALATE_AFTER_WEEKS: z.coerce.number().int().positive().default(2),

  SIGNAL_TYPE_STATS_CRON: z.string().min(1).default('0 2 * * *'),
  SIGNAL_TYPE_DRIFT_SIGMA_THRESHOLD: z.coerce.number().positive().default(3.0),

  AUTORULE_ENABLED: zBool(false),
  AUTORULE_MIN_FEEDBACK_FOR_EXTRACT: z.coerce.number().int().positive().default(10),
  AUTORULE_MIN_CONFIDENCE_FOR_PROMOTE: z.coerce.number().min(0).max(1).default(0.7),
  AUTORULE_KNN_GROUP_THRESHOLD: z.coerce.number().min(0).max(1).default(0.78),
  AUTORULE_RULE_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.9),

  PRACTICE_SKILLS_ENABLED: zBool(true),
  PRACTICE_SKILLS_MIN_TRAITS_FOR_EXTRACT: z.coerce.number().int().positive().default(5),
  PRACTICE_SKILLS_SHADOW_TRAFFIC: z.coerce.number().min(0).max(1).default(0.1),
  PRACTICE_SKILLS_KNN_RETRIEVAL_THRESHOLD: z.coerce.number().min(0).max(1).default(0.78),
  PRACTICE_SKILLS_KNN_DEDUP_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),
  PRACTICE_SKILLS_EVAL_MIN_RUNS: z.coerce.number().int().positive().default(30),
  PRACTICE_SKILLS_EVAL_PROMOTE_DELTA: z.coerce.number().min(0).max(1).default(0.05),
  PRACTICE_SKILLS_EVAL_ARCHIVE_DELTA: z.coerce.number().min(0).max(1).default(0.05),

  PROMPT_EVOLUTION_ENABLED: zBool(false),
  GEPA_MAX_METRIC_CALLS: z.coerce.number().int().positive().default(150),
  GEPA_REFLECTION_LM: z.string().min(1).default('deepseek-v4-pro'),
  GEPA_TASK_LM: z.string().min(1).default('deepseek-v4-pro'),
  GEPA_AB_TRAFFIC_SHARE: z.coerce.number().min(0).max(1).default(0.1),
  GEPA_AB_MIN_INVOCATIONS_BEFORE_DECISION: z.coerce.number().int().positive().default(100),
  GEPA_AB_PROMOTE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.05),
  GEPA_AB_REJECT_THRESHOLD: z.coerce.number().min(0).max(1).default(0.1),
  GEPA_SERVICE_URL: z.string().url().default('http://gepa:8000'),
  GEPA_TIMEOUT_MS: z.coerce.number().int().positive().default(3_600_000),
});

const SmartTablesSchema = z.object({
  TABLE_MAX_ROWS_PER_TABLE: z.coerce.number().int().positive().default(100_000),
  TABLE_MAX_PROPS_PER_TABLE: z.coerce.number().int().positive().default(200),
  TABLE_MAX_TABLES_PER_ORG: z.coerce.number().int().positive().default(1_000),
  TABLE_MAX_CELL_SIZE_BYTES: z.coerce.number().int().positive().default(1_048_576),
  TABLE_IMPORT_MAX_FILE_MB: z.coerce.number().int().positive().default(25),
  TABLE_IMPORT_MAX_ROWS: z.coerce.number().int().positive().default(5_000),
});

const LoggingSchema = z.object({
  LOG_DB_ENABLED: zBool(true),
  LOG_DB_MIN_LEVEL: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']).default('INFO'),
  LOG_DB_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(50),
  LOG_DB_FLUSH_INTERVAL_MS: z.coerce.number().int().min(500).max(600_000).default(5_000),
  LOG_DB_MAX_BUFFER: z.coerce.number().int().min(100).max(100_000).default(5_000),
  LOG_DB_RETENTION_DAYS: z.coerce.number().int().min(1).max(3_650).default(30),
  LOG_DB_STACK_TRACES: zBool(true),
  LOG_DB_REQUEST_BODY: zBool(false),
  LOG_DB_RESPONSE_BODY: zBool(false),
  LOG_DB_SUCCESS_REQUESTS: zBool(false),
  LOG_DB_SLOW_REQUEST_MS: z.coerce.number().int().min(0).max(600_000).default(2_000),
});

const SharedDemoOrgSchema = z.object({
  ZDEMO_ORG_ID: z.string().min(1).optional(),
});

const BillingSchema = z.object({
  BILLING_PROVIDER: z.enum(['tochka', 'manual']).default('manual'),
  FEATURE_BILLING_TOCHKA: zBool(false),
  FEATURE_BILLING_CARD_RECURRING: zBool(false),
  FEATURE_BILLING_BANK_INVOICE: zBool(false),
  BILLING_PUBLIC_API_URL: z.string().url().optional(),
  BILLING_SUCCESS_REDIRECT_URL: z.string().url().optional(),
  BILLING_FAIL_REDIRECT_URL: z.string().url().optional(),

  BILLING_LEGAL_ENTITY_NAME: z.string().optional(),
  BILLING_LEGAL_ENTITY_INN: z
    .string()
    .regex(/^\d{10}(\d{2})?$/)
    .optional(),
  BILLING_LEGAL_ENTITY_KPP: z
    .string()
    .regex(/^\d{9}$/)
    .optional(),
  BILLING_LEGAL_ENTITY_ADDRESS: z.string().optional(),
  BILLING_LEGAL_ENTITY_BIK: z
    .string()
    .regex(/^\d{9}$/)
    .optional(),
  BILLING_LEGAL_ENTITY_ACCOUNT: z
    .string()
    .regex(/^\d{20}$/)
    .optional(),

  TOCHKA_MODE: z.enum(['sandbox', 'production']).default('sandbox'),
  TOCHKA_API_VERSION: z.string().default('v1.0'),
  TOCHKA_API_BASE_URL: z.string().url().optional(),
  TOCHKA_CUSTOMER_CODE: z.string().optional(),
  TOCHKA_ACCOUNT_ID: z.string().optional(),
  TOCHKA_MERCHANT_ID: z.string().optional(),
  TOCHKA_CLIENT_ID: z.string().optional(),
  TOCHKA_CLIENT_SECRET: z.string().optional(),
  TOCHKA_REDIRECT_URI: z.string().url().optional(),
  TOCHKA_JWT_TOKEN: z.string().optional(),
  TOCHKA_OAUTH_SCOPES: z
    .string()
    .default('accounts balances customers statements sbp payments acquiring'),
  TOCHKA_OAUTH_PERMISSIONS: z
    .string()
    .default(
      'ReadAccountsBasic,ReadAccountsDetail,ReadCustomerData,MakeAcquiringOperation,ReadAcquiringData,ManageWebhookData,ManageInvoiceData',
    ),
  TOCHKA_OAUTH_CONSENT_EXPIRES_AT: z.string().optional(),
  TOCHKA_WEBHOOK_URL: z.string().url().optional(),
  TOCHKA_WEBHOOK_EVENT_TYPES: z.string().default('acquiringInternetPayment'),
  TOCHKA_WEBHOOK_AUTO_REGISTER: zBool(false),
  TOCHKA_WEBHOOK_PUBLIC_KEY_URL: z
    .string()
    .url()
    .default('https://enter.tochka.com/doc/openapi/static/keys/public'),

  DADATA_API_KEY: z.string().optional(),
  INN_LOOKUP_PROVIDER: z.enum(['mock', 'dadata', 'tochka_then_dadata']).default('mock'),
  INN_LOOKUP_CACHE_TTL_DAYS: z.coerce.number().int().positive().default(30),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const EnvSchema: z.ZodTypeAny = (RuntimeSchema as unknown as any)
  .merge(DatabaseSchema)
  .merge(RedisSchema)
  .merge(AuthSchema)
  .merge(ArgonSchema)
  .merge(MailSchema)
  .merge(LiveKitSchema)
  .merge(TurnSchema)
  .merge(S3Schema)
  .merge(AnthropicSchema)
  .merge(LlmRouterSchema)
  .merge(VoxSchema)
  .merge(OpenAiSchema)
  .merge(DeepSeekSchema)
  .merge(OllamaSchema)
  .merge(MiniMaxSchema)
  .merge(GrsAiSchema)
  .merge(KieSchema)
  .merge(ProxySchema)
  .merge(EmbeddingsSchema)
  .merge(CrossmarkSchema)
  .merge(RetentionSchema)
  .merge(IdleSchema)
  .merge(RecordingReliabilitySchema)
  .merge(QuotasSchema)
  .merge(AdminSchema)
  .merge(WebhooksOutSchema)
  .merge(WorkspaceLimitsSchema)
  .merge(AiFeatureFlagsSchema)
  .merge(HashingSchema)
  .merge(ShareSchema)
  .merge(IngestSchema)
  .merge(CryptoSchema)
  .merge(EmailFetchSchema)
  .merge(KnowledgeCoreSchema)
  .merge(DocumentIngestSchema)
  .merge(ExtractionSchema)
  .merge(ConversationalSchema)
  .merge(PushSchema)
  .merge(TelegramBotChannelSchema)
  .merge(TelegramProxySchema)
  .merge(MaxBotChannelSchema)
  .merge(RouterSchema)
  .merge(CurationSchema)
  .merge(KnowledgeCloneSchema)
  .merge(InsightsSchema)
  .merge(IdeasSchema)
  .merge(ProbeSchema)
  .merge(SkillSchema)
  .merge(PersonaSchema)
  .merge(ProcessTemplateSchema)
  .merge(DialogLayerSchema)
  .merge(BetaOpsSchema)
  .merge(BudgetSchema)
  .merge(TrackerSchema)
  .merge(BillingSchema)
  .merge(AiChatQuotaSchema)
  .merge(SmartTablesSchema)
  .merge(LoggingSchema)
  .merge(SharedDemoOrgSchema)
  .merge(ConciergeSchema)
  .merge(OrchestratorSchema)
  .merge(WorkerKnobsSchema);

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(raw: Record<string, unknown>): Record<string, unknown> {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Невалидная конфигурация ENV. Проверь .env (см. .env.example).\n${issues}`);
  }
  return result.data as unknown as Record<string, unknown>;
}
