import { z } from 'zod';

/**
 * Boolean из ENV-строки. НЕЛЬЗЯ `z.coerce.boolean()` — он делает `Boolean(v)`,
 * а `Boolean("false") === true` (любая непустая строка → true). Поэтому парсим явно:
 *   true/1/yes/on → true;  false/0/no/off/'' / отсутствие → false.
 */
const zBool = (def: boolean) =>
  z.preprocess((v) => {
    if (v === undefined || v === null || v === '') return def;
    if (typeof v === 'boolean') return v;
    const s = String(v).trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(s)) return true;
    if (['false', '0', 'no', 'off'].includes(s)) return false;
    return v; // мусор → z.boolean() даст внятную ошибку валидации
  }, z.boolean());

/**
 * Полная zod-схема ENV проекта Z.
 * Источник:
 *   - plans/architecture/2026-05-08-z-architecture.md §6.7
 *   - plans/tz/2026-05-09-standalone-product.md (SMTP, argon2)
 *   - plans/tz/2026-05-09-ai-meeting-workspace.md (embeddings, webhooks, лимиты, квоты, SSRF, encryption)
 *
 * Принципы:
 *  - Все обязательные ключи помечены без default. Падаем на старте, если их нет.
 *  - Числа — через z.coerce; булевы — через zBool (см. выше; z.coerce.boolean НЕ годится).
 *  - Никаких `any`, никаких хардкодов вне этого файла.
 */

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
  /** Домен для cookie standalone-логина (узкий, чтобы не отдавать сессию на чужие поддомены crossmark.ru). */
  COOKIE_STANDALONE_DOMAIN: z.string().min(1).optional(),
  PUBLIC_FRONTEND_URL: z.string().url(),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
  DEEP_LINK_TTL_SECONDS: z.coerce.number().int().positive().default(900),
});

/** argon2id — для standalone-аккаунтов (ТЗ standalone-product §Backend). */
const ArgonSchema = z.object({
  ARGON_MEMORY_KB: z.coerce.number().int().positive().default(19_456), // 19 MiB — OWASP 2024
  ARGON_ITERATIONS: z.coerce.number().int().positive().default(2),
  ARGON_PARALLELISM: z.coerce.number().int().positive().default(1),
});

/** SMTP (mail.hosting.reg.ru). Используется MailService для standalone-онбординга. */
const MailSchema = z.object({
  MAIL_HOST: z.string().min(1).default('mail.hosting.reg.ru'),
  MAIL_PORT: z.coerce.number().int().positive().default(465),
  MAIL_SSL: zBool(true),
  MAIL_USERNAME: z.string().min(1).optional(),
  MAIL_PASSWORD: z.string().min(1).optional(),
  MAIL_FROM: z.string().email().default('noreply@crossmark.ru'),
  MAIL_FROM_NAME: z.string().default('Z'),
  /** При true — MailService логирует письма вместо реальной отправки (dev/test). */
  MAIL_DRY_RUN: zBool(false),
});

const LiveKitSchema = z.object({
  LIVEKIT_API_URL: z.string().url(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  LIVEKIT_WEBHOOK_API_KEY: z.string().min(1),
  LIVEKIT_WEBHOOK_API_SECRET: z.string().min(1),
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

const VoxSchema = z.object({
  VOX_API_URL: z.string().url().default('https://vox.agent-lia.ru'),
  VOX_API_TOKEN: z.string().min(1),
  VOX_MODEL: z.string().min(1).default('v3_rnnt'),
  VOX_LANGUAGE: z.string().min(1).default('ru'),
  VOX_PUNCTUATION_MODE: z.string().min(1).default('pro'),
});

const OpenAiSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
});

const DeepSeekSchema = z.object({
  DEEPSEEK_API_KEY: z.string().min(1),
  DEEPSEEK_BASE_URL: z.string().url().default('https://api.deepseek.com/v1'),
  DEEPSEEK_DEFAULT_MODEL: z.string().min(1).default('deepseek-v4-flash'),
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

/** Embeddings для cross-meeting RAG (ai-workspace ТЗ §EmbeddingService). */
const EmbeddingsSchema = z.object({
  EMBEDDING_PROVIDER: z.enum(['openai-via-proxy', 'local', 'openai-direct']).default('openai-via-proxy'),
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
  /** Через сколько дней soft-delete users/meetings → hard-delete воркером. */
  SOFT_DELETE_GRACE_DAYS: z.coerce.number().int().positive().default(30),
  /** Retention для подсобных таблиц. */
  WEBHOOK_DELIVERY_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  SHARE_VIEW_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  API_ACCESS_LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  /**
   * Фаза 11 — knowledge-core retention (per-Org через `OrgRetentionPolicy`).
   * Здесь — глобальные тумблеры и размер batch'а.
   *
   *   - RETENTION_SWEEP_BATCH_SIZE — сколько строк за один проход на kind.
   *   - RETENTION_*_ENABLED — включает соответствующий sweep в processAll().
   *
   * На фазе 11 RAW/AUDIT/BLOCKS по умолчанию выключены — включаются на проде
   * операционно после полного бэкапа. CHAT включён сразу (90 дней).
   */
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

/** Базовые лимиты MVP. */
const QuotasSchema = z.object({
  MAX_PARTICIPANTS_PER_MEETING: z.coerce.number().int().positive().default(10),
  MAX_MEETING_DURATION_HOURS: z.coerce.number().int().positive().default(8),
});

const AdminSchema = z.object({
  ADMIN_BOOTSTRAP_EMAIL: z.string().email().optional(),
  ADMIN_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(43_200),
});

/** Webhooks-исходящие из Z. Шифрование секретов envelope-style через AES-GCM. */
const WebhooksOutSchema = z.object({
  /** 32 байта (256 бит), base64. Генерация: `openssl rand -base64 32`. */
  WEBHOOK_SECRETS_ENCRYPTION_KEY: z
    .string()
    .min(1)
    .refine(
      (v) => {
        try {
          return Buffer.from(v, 'base64').length === 32;
        } catch {
          return false;
        }
      },
      'WEBHOOK_SECRETS_ENCRYPTION_KEY должен быть base64 от 32 байт (256 бит)',
    ),
  WEBHOOK_DELIVERY_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().positive().default(8),
  /** CSV whitelist хостов, разрешённых для webhook-доставки (на проде — оставить пустым, всё кроме приватных CIDR). */
  WEBHOOK_EGRESS_ALLOWED_HOSTS: z.string().default(''),
});

/** Лимиты ai-workspace. */
const WorkspaceLimitsSchema = z.object({
  CLIP_MAX_DURATION_SECONDS: z.coerce.number().int().positive().default(300),
  EXPORT_ZIP_MAX_MEETINGS: z.coerce.number().int().positive().default(100),
  EXPORT_ZIP_MAX_SIZE_BYTES: z.coerce.number().int().positive().default(21_474_836_480), // 20GB

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
  /** Сколько раз в сутки на Org можно вручную пересчитать strategic-alignment
   *  цели (Фаза 9). Защита от LLM-злоупотреблений. */
  MAX_GOAL_RECOMPUTE_PER_DAY: z.coerce.number().int().positive().default(5),

  MAX_HIGHLIGHTS_PER_MEETING: z.coerce.number().int().positive().default(50),
  MAX_BULK_OPERATION_IDS: z.coerce.number().int().positive().default(200),
  MAX_CHAT_MESSAGE_CHARS: z.coerce.number().int().positive().default(8_000),

  /** CRM-карточки: лимит активных карточек на пользователя. */
  MAX_CARDS_PER_USER: z.coerce.number().int().positive().default(500),
  /** Сколько раз в сутки на пользователя можно автоматически пересобирать card-rollup. */
  MAX_CARD_ROLLUPS_PER_DAY: z.coerce.number().int().positive().default(100),

  /** Максимум символов в одном in-meeting room-chat сообщении (см. ТЗ meeting-room-chat). */
  MAX_ROOM_MESSAGE_CHARS: z.coerce.number().int().positive().default(2_000),
});

/**
 * Feature-flags для AI-pipeline. Отделены от провайдерских настроек,
 * чтобы включение/выключение блока контекста не зависело от ENV модели.
 */
const AiFeatureFlagsSchema = z.object({
  /**
   * Подмешивать ли in-meeting room-chat в merged-объект для AI-отчёта.
   * См. ТЗ meeting-room-chat §AI-pipeline.
   */
  INCLUDE_ROOM_CHAT_IN_AI: zBool(true),
  /**
   * Фаза D (sub-TZ 2026-05-21-phase-D-transcript-cleaning §6.2) —
   * Включает уровень 2 LLM-уточнения в воркере `ai.transcript-clean`.
   * По умолчанию `true` — LLM-refine дешёвый (~$0.05 на 100 мин)
   * и заметно улучшает качество. При `false` — воркер работает только
   * через детерминистский уровень 1 (словарь + повторы), это всегда корректно.
   */
  TRANSCRIPT_CLEANING_LLM_REFINE_ENABLED: zBool(true),
  /**
   * Фаза B (sub-TZ 2026-05-21-phase-B-meeting-behavior-metrics §7) —
   * Включает LLM-refine в воркере `ai.behavior-metrics` (классификация
   * filler-кандидатов и question-кандидатов). По умолчанию `false` —
   * детерминистского достаточно для MVP паритета; включаем после пилотных
   * оценок (B DoD §11).
   */
  BEHAVIOR_METRICS_LLM_REFINE_ENABLED: zBool(false),
  /**
   * ТЗ 2026-05-24 §4 (F1 prompt-injection guard) — мастер-флаг защиты от
   * prompt-injection. При `true` (default):
   *   - customPrompt идёт в `user` внутри маркеров `<<<USER_DATA_BEGIN>>>...`;
   *   - в `system` подмешана `INJECTION_GUARD_NOTE`;
   *   - sanitize считает срабатывания regex → метрика
   *     `z_prompt_injection_attempt_total`.
   * При `false` — старое поведение (customPrompt как system без обёрток) для
   * быстрого rollback (см. §13 ТЗ). После уверенного прохода в проде неделю+
   * флаг убираем — поведение становится дефолтом.
   */
  PROMPT_INJECTION_GUARD_ENABLED: zBool(true),
});

/** Daily-rotated salt для anti-cheat подсчёта view (ipHash) — на проде хранится в secret-storage. */
const HashingSchema = z.object({
  IP_HASH_DAILY_SALT: z.string().min(16).default('change-me-in-prod-please-32chars'),
});

/**
 * knowledge-core (Фаза 1) — внутренний shared-secret для guard'а POST /api/v1/ingest.
 * Используется только адаптерами, которые живут вне backend-процесса (например,
 * будущие telegram/email/IMAP-listener'ы из Фазы 10). In-process meeting-adapter
 * вызывает `IngestService` напрямую и токен не использует.
 *
 * На Фазе 1 пустая строка допустима — endpoint вернёт 503, пока DevOps не
 * сгенерирует токен (длина 40+ символов, например `openssl rand -hex 32`).
 */
const IngestSchema = z.object({
  INGEST_INTERNAL_TOKEN: z.string().default(''),
});

/**
 * knowledge-core (Фаза 10) — общая crypto-обвязка для шифрования секретов
 * адаптеров (botToken Telegram, apiKey/apiSalt Mango, password IMAP).
 *
 * `CRYPTO_MASTER_KEY` — base64 от 32 байт (256 бит). Для AES-256-GCM.
 * Генерация: `openssl rand -base64 32`. На dev допустима пустая строка —
 * `CryptoService` бросает только при первой попытке шифрования.
 *
 * `PUBLIC_HOST_URL` — внешний адрес backend'а (без trailing slash). Нужен
 * Telegram-адаптеру для `setWebhook`. По умолчанию равен PUBLIC_FRONTEND_URL,
 * но в проде их обычно разделяют (frontend — vercel, backend — наш сервер).
 */
const CryptoSchema = z.object({
  CRYPTO_MASTER_KEY: z.string().default(''),
  PUBLIC_HOST_URL: z.string().url().optional(),
});

/**
 * knowledge-core (Фаза 0b) — document-ingest pipeline.
 *
 * `DOCUMENT_PARSE_TIMEOUT_MS` — таймаут на один парсинг документа (pdf-parse /
 * mammoth / marked). При превышении — `ParseTimeoutError`, документ
 * переводится в `failed` со статус-сообщением. По умолчанию 30 секунд.
 *
 * `DOCUMENT_MAX_SIZE_MB` — максимальный размер файла, обрабатываемого
 * парсером. Сверка делается ДО запуска парсера (по `originalSize`). При
 * превышении — `ParseSizeError`. По умолчанию 50 MiB.
 *
 * `DOCUMENT_INLINE_THRESHOLD_MB` — порог, ниже которого содержимое
 * хранится в `Document.inlineContent` (`Bytes`); выше — уезжает в S3
 * (`Document.s3Key`). По умолчанию 10 MiB (см. зонтичный TZ §4.4).
 *
 * `S3_BUCKET_DOCUMENTS` — отдельный bucket для документов. Если пустая
 * строка — переиспользуем основной `S3_BUCKET` (по умолчанию). Это нужно,
 * чтобы локально на одном MinIO всё работало без отдельного bucket'а.
 */
const DocumentIngestSchema = z.object({
  DOCUMENT_PARSE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  DOCUMENT_MAX_SIZE_MB: z.coerce.number().int().positive().default(50),
  DOCUMENT_INLINE_THRESHOLD_MB: z.coerce.number().int().positive().default(10),
  S3_BUCKET_DOCUMENTS: z.string().default(''),
});

/**
 * Extraction (Фаза 0b §6, §11 ТЗ).
 *
 * `EXTRACTION_ENABLE_TOP_LEVEL` — мастер-флаг автоизвлечения Mission/Vision/
 * Strategy из текстов. По умолчанию false (зонтичный §6 решение #11). Когда
 * выставлен в true — LLM может возвращать заполненные mission/vision/strategy
 * и `GraphService.upsertEntity({type: 'mission'|'vision'|'strategy'})` начнёт
 * работать. На Фазе 0b всегда false.
 *
 * `EXTRACTION_TYPED_ENTITY_MIN_CONFIDENCE` — порог confidence для сохранения
 * типизированных сущностей группы Б (Process/Decision/Regulation/Policy/
 * Metric/Tool) после LLM-извлечения. 0.5 по умолчанию (см. ТЗ 0b §6.2).
 */
const ExtractionSchema = z.object({
  EXTRACTION_ENABLE_TOP_LEVEL: z.coerce.boolean().default(false),
  EXTRACTION_TYPED_ENTITY_MIN_CONFIDENCE: z.coerce
    .number()
    .min(0)
    .max(1)
    .default(0.5),
});

/**
 * knowledge-core (Фаза 10) — email IMAP-адаптер.
 *
 * `EMAIL_FETCH_ENABLED` — мастер-флаг cron'а; default false (на dev'е cron не
 * запускается, чтобы не дёргать продовые ящики при локальной разработке).
 *
 * `EMAIL_FETCH_CRON` — расписание cron'а (default — каждые 5 минут).
 * `EMAIL_FETCH_MAX_PER_RUN` — лимит писем за один проход на Source.
 */
const EmailFetchSchema = z.object({
  EMAIL_FETCH_ENABLED: zBool(false),
  EMAIL_FETCH_CRON: z.string().min(1).default('*/5 * * * *'),
  EMAIL_FETCH_MAX_PER_RUN: z.coerce.number().int().positive().default(50),

  // Tracker Phase 4 (Email-to-task, T5) — общий IMAP-ящик `inbox.kora.app`.
  // Поллинг через `ImapPollCron` → routing по `To:`-alias → IssuesService.create().
  // ENV здесь (а не отдельной MailInboxSchema) — чтобы не наращивать длину
  // `.merge` цепочки EnvSchema (TS2589).
  MAIL_INBOX_ENABLED: zBool(false), // глобальный kill-switch (по умолчанию выкл.)
  MAIL_INBOX_DOMAIN: z.string().min(1).default('inbox.kora.app'),
  MAIL_INBOX_IMAP_HOST: z.string().optional(),
  MAIL_INBOX_IMAP_PORT: z.coerce.number().int().positive().default(993),
  MAIL_INBOX_IMAP_USER: z.string().optional(),
  MAIL_INBOX_IMAP_PASS: z.string().optional(),
  MAIL_INBOX_IMAP_TLS: zBool(true),
  MAIL_INBOX_IMAP_FOLDER: z.string().min(1).default('INBOX'),
  MAIL_INBOX_POLL_CRON: z.string().min(1).default('*/2 * * * *'),
  MAIL_INBOX_MAX_PER_RUN: z.coerce.number().int().positive().default(50),
  // Если письмо пришло на alias другого tenant'а — это нормальный bounce.
  // tenantId определяется из `Project.tenantId` найденного по alias (alias unique).
});

/**
 * knowledge-core (Фаза 2+) — параметры дистилляции IdeaBlock'ов и Entity-резолвера.
 *
 * - DISTILL_MERGE_THRESHOLD: cosine-сходство, выше которого блок считается
 *   кандидатом на merge. 0.92 — эмпирический порог OpenAI text-embedding-3-small.
 * - DISTILL_DEBOUNCE_MS: задержка enqueue в `core.block-distill`. Свежий блок
 *   ждёт N мс, прежде чем его «распилит» distill-воркер — даёт шанс другим
 *   блокам из той же встречи приехать и сравниться сразу.
 * - DISTILL_KNN_TOP_K: сколько ближайших canonical-блоков предъявить LLM-арбитру.
 * - ENTITY_MERGE_THRESHOLD: то же для Entity (Шаг 4, заранее).
 * - ENTITY_RESOLVER_CRON: расписание прохода entity-merge-arbiter (Шаг 4).
 * - BLOCK_INGEST_WINDOW_SEGMENTS: сколько сегментов скармливаем LLM за один
 *   block-ingest-вызов. 5 — компромисс между качеством (больше контекста) и
 *   стоимостью (меньше токенов).
 * - BLOCK_INGEST_MAX_TOKENS_PER_SEGMENT: грубый предел длины одного сегмента;
 *   проверяется как `chars/4 > limit` в SegmentBuilderService.
 * - SEARCH_COSINE_WEIGHT / SEARCH_BM25_WEIGHT: коэффициенты гибридного скоринга
 *   (Шаг 5). Сумма не нормируется здесь, но обычно ~1.
 */
const KnowledgeCoreSchema = z.object({
  DISTILL_MERGE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.92),
  DISTILL_DEBOUNCE_MS: z.coerce.number().int().positive().default(30_000),
  DISTILL_KNN_TOP_K: z.coerce.number().int().positive().default(5),
  ENTITY_MERGE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.88),
  ENTITY_RESOLVER_CRON: z.string().min(1).default('*/5 * * * *'),
  BLOCK_INGEST_WINDOW_SEGMENTS: z.coerce.number().int().positive().default(5),
  BLOCK_INGEST_MAX_TOKENS_PER_SEGMENT: z.coerce.number().int().positive().default(2000),
  SEARCH_COSINE_WEIGHT: z.coerce.number().min(0).max(1).default(0.7),
  SEARCH_BM25_WEIGHT: z.coerce.number().min(0).max(1).default(0.3),

  // ── Фаза 3: связи и граф ──
  /**
   * Минимальный confidence LLM-арбитра, при котором связь блок↔блок или
   * сущность↔сущность пишется в БД. Ниже — выбрасывается. 0.75 — компромисс
   * между шумом (LLM любит выдумывать) и пропуском настоящих связей.
   */
  LINK_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.75),
  /**
   * Порог количества канонических блоков в Org, ниже которого block-linker
   * пропускает запуск (нечего связывать). 50 — базовая критическая масса.
   */
  LINKER_MIN_BLOCKS: z.coerce.number().int().positive().default(50),
  /**
   * Сколько KNN-кандидатов на типизированную связь предъявить LLM-арбитру
   * за один проход block-linker. Каждый кандидат — отдельный LLM-вызов
   * (последовательно, чтобы не словить rate limit).
   */
  LINK_KNN_TOP_K: z.coerce.number().int().positive().default(10),
  /**
   * Cron-расписание `reframing.worker` (рефлексия графа: архивация слабых
   * связей, dynamicScore decay, LLM-анализ свежих блоков). По умолчанию —
   * раз в сутки в 3 утра.
   */
  REFRAMING_CRON: z.string().min(1).default('0 3 * * *'),
  /**
   * Сколько дней без обновления делает блок «застойным» — после чего ночной
   * reframing понижает ему dynamicScore. 90 дней = полный квартал.
   */
  BLOCK_DYNAMIC_SCORE_DECAY_DAYS: z.coerce.number().int().positive().default(90),
  /**
   * Cron-расписание `entity-graph-builder.cron` — раз в час по умолчанию.
   * Отдельная от reframing очередь: лёгкий проход, ищет co-mentioned пары
   * сущностей и предлагает им связь LLM-арбитру.
   */
  ENTITY_GRAPH_BUILDER_CRON: z.string().min(1).default('0 * * * *'),
  /**
   * Минимум совместных упоминаний пары сущностей в одних блоках, ниже
   * которого entity-graph-builder её игнорирует. 3 — порог «не случайность».
   */
  ENTITY_GRAPH_MIN_COMENTIONS: z.coerce.number().int().positive().default(3),

  // ── Фаза 4: Theme + clusterer + card-rollup-v2 ──
  /**
   * Cron-расписание `theme-clusterer.cron` — каждый час в :15 по умолчанию.
   * Лёгкий проход; реальный объём LLM-вызовов ограничен порогом
   * `THEME_CLUSTERING_MIN_BLOCKS` (Org с малым количеством блоков пропускается).
   */
  THEME_CLUSTERER_CRON: z.string().min(1).default('15 * * * *'),
  /**
   * Минимум canonical-блоков без темы в Org, ниже которого theme-clusterer
   * пропускает Org (нечего кластеризовать). 100 — критическая масса для
   * стабильных тем.
   */
  THEME_CLUSTERING_MIN_BLOCKS: z.coerce.number().int().positive().default(100),
  /**
   * Минимальный размер устойчивого кластера (в блоках). Меньше — кластер
   * выбрасывается как шум. 3 — компромисс «не случайность, но и не строго».
   */
  THEME_CLUSTER_MIN_SIZE: z.coerce.number().int().positive().default(3),
  /**
   * Cosine-порог объединения блоков в один кластер при KNN-greedy.
   * 0.78 — эмпирический порог OpenAI text-embedding-3-small для «одна тема».
   */
  THEME_COSINE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.78),
  /**
   * Дебаунс enqueue в `core.card-rollup-v2`: несколько событий по одной Card
   * за окно складываются в один отложенный job. 60 секунд — достаточный
   * запас, чтобы догнать «пачку» link/unlink/regenerate.
   */
  CARD_ROLLUP_V2_DEBOUNCE_MS: z.coerce.number().int().positive().default(60_000),

  // ── Фаза 5: meeting-analyze-v2 (Tasks-2.0/Chapters-2.0/Summary-2.0) ──
  /**
   * Master-флаг v2-агентов. По умолчанию `false`, чтобы legacy
   * `tasks-extract.worker`/`chapters.worker` остались единственным источником
   * данных в UI. При `true` — `meeting-analyze-v2.cron` начинает enqueue'ить
   * jobs, которые пишут в `Task.evidenceBlockIds`/`MeetingChapter.evidenceBlockIds`/
   * `AiResult.summaryV2` — параллельно legacy.
   *
   * Включается на проде вручную для A/B-сравнения. Удалить legacy — отдельная
   * фаза после ручного решения владельца продукта (см. decisions-log).
   */
  KNOWLEDGE_CORE_V2_AGENTS_ENABLED: zBool(false),
  /**
   * Cron-расписание `meeting-analyze-v2.cron` — каждые 10 минут по умолчанию.
   * Cron-выражение в декораторе литералом, ENV-значение для логов и для
   * будущей перерегистрации через `SchedulerRegistry`.
   */
  MEETING_ANALYZE_V2_CRON: z.string().min(1).default('*/10 * * * *'),
  /**
   * Дебаунс enqueue в `core.meeting-analyze-v2`: после `meeting.status='ai_ready'`
   * мы ждём 2 минуты, чтобы block-ingest/distill успели стабилизироваться
   * (canonical-блоки могут «доезжать» спустя несколько секунд после ai_ready).
   * Несколько событий по одной встрече за окно складываются в один job.
   */
  MEETING_ANALYZE_V2_DEBOUNCE_MS: z.coerce.number().int().positive().default(120_000),

  // ── ТЗ 2026-05-25: meeting-report-fast (объединённый отчёт по сырому транскрипту) ──
  /**
   * Master-флаг новой быстрой цепочки отчёта (см. ТЗ
   * plans/tz/2026-05-25-meeting-report-split-from-block-ingest.md, Фаза 4).
   * При `true` после успешной склейки транскрипта (`MergeWorker`)
   * producer ставит job в `core.meeting-report-fast` ПАРАЛЛЕЛЬНО с
   * existing `ai.analyze` цепочкой / `meeting-analyze-v2` cron'ом —
   * для A/B-сравнения качества на dev-трафике.
   *
   * Default `true` — на dev включаем сразу; на prod выключать через ENV
   * до явного подтверждения качества (kill-switch).
   *
   * Старая цепочка `meeting-analyze-v2` НЕ переключается этим флагом —
   * она имеет собственный `KNOWLEDGE_CORE_V2_AGENTS_ENABLED`.
   */
  MEETING_REPORT_FAST_ENABLED: zBool(true),

  // ── Фаза 6: единый AI-чат поверх IdeaBlock'ов (5 scope: org/meeting/card/theme/entity) ──
  /**
   * Master-флаг ChatV2. По умолчанию `false` — существующие чат-эндпоинты
   * (`POST /api/v1/chat`, `POST /api/v1/meetings/:id/chat`,
   * `POST /api/v1/cards/:id/chat`) работают через legacy `ChatService`. При
   * `true` — контроллер переключается на `ChatV2Service` (retrieval по
   * IdeaBlock + 1-hop graph expansion). История чата общая (`MeetingChatMessage`),
   * формат citations совместим с legacy. Включается на проде вручную для
   * A/B-сравнения. Удаление legacy — отдельная фаза.
   */
  CHAT_V2_ENABLED: zBool(false),
  /**
   * Сколько top-K блоков подмешиваем в LLM-контекст ChatV2. 12 — компромисс
   * между качеством (больше блоков → больше шансов попасть в нужный) и
   * стоимостью токенов.
   */
  CHAT_V2_TOP_BLOCKS: z.coerce.number().int().positive().default(12),
  /**
   * Сколько шагов 1-hop graph-расширения добавлять к top-K кандидатам через
   * `IdeaBlockLink`. Дефолт 1 = «прямые соседи»; добавляет до K*5 блоков.
   * 0 = расширение выключено.
   */
  CHAT_V2_GRAPH_HOPS: z.coerce.number().int().min(0).max(2).default(1),

  // ── SBA α-5 — Layer 5 Chat-v2 Omnichannel (модуль chat-v2/) ──────────
  /**
   * История диалога: сколько последних сообщений передавать в LLM-контекст.
   * 6 = 3 user + 3 assistant (рекомендация ChatV2Service из knowledge-core).
   */
  CHAT_V2_HISTORY_MESSAGES: z.coerce.number().int().min(0).max(20).default(6),
  /**
   * TTL диалогов: после стольких дней без updatedAt диалог авто-архивируется
   * (если не pinned). Cron `chat-v2-cleanup.cron` — раз в неделю.
   */
  CHAT_V2_CONVERSATION_TTL_DAYS: z.coerce.number().int().positive().default(90),
  /**
   * Cron-расписание авто-архивации (по умолчанию — воскресенье 03:00).
   */
  CHAT_V2_CLEANUP_CRON: z.string().min(1).default('0 3 * * 0'),
  /**
   * Дефолтный mode для chat-v2 (factual/synthetic/clone_style). На α-5
   * clone_style не реализован — fallback на synthetic.
   */
  CHAT_V2_DEFAULT_MODE: z.enum(['factual', 'synthetic', 'clone_style']).default('synthetic'),
});

/** Шеринг (длительность ссылок). */
const ShareSchema = z.object({
  SHARE_TOKEN_LENGTH_BYTES: z.coerce.number().int().min(16).default(24), // 32 base64url chars
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

/**
 * SBA α-3 — Layer 2 Ontology Extension + RouterService.
 *
 * `ROUTER_DISPATCH_CONCURRENCY` — concurrency BullMQ-воркеров специалистов
 * (фактическое значение — на стороне consumer'ов в α-6/α-7/β-2/β-3/γ-1).
 * Здесь — только потолок, чтобы не выставить разные значения по разным sub-TZ.
 *
 * `ROUTER_MAX_SPECIALISTS_PER_BLOCK` — анти-fan-out: если на один блок мapping
 * выдал больше N специалистов, оставляем top-N по приоритету (см.
 * `RouterService.PRIORITY`). Default 4.
 */
const RouterSchema = z.object({
  ROUTER_DISPATCH_CONCURRENCY: z.coerce.number().int().positive().default(4),
  ROUTER_MAX_SPECIALISTS_PER_BLOCK: z.coerce.number().int().positive().default(4),
});

/**
 * SBA α-1 — Conversational Channels Foundation.
 * Параметры outbound-очереди, link-кодов, anti-spam дефолтов.
 *
 *   - CONVERSATIONAL_OUTBOUND_CONCURRENCY — concurrency BullMQ-воркера,
 *     отправляющего notifications в каналы.
 *   - CONVERSATIONAL_LINK_CODE_TTL_SEC — TTL одноразового кода для linking-
 *     flow (10 минут по умолчанию; код хранится в Redis).
 *   - CONVERSATIONAL_QUIET_HOURS_DEFAULT — дефолтное окно «тихих часов»
 *     в формате `HH:mm-HH:mm` (применяется в локали пользователя; для α-1
 *     — серверная TZ, локализация в β+).
 *   - CONVERSATIONAL_RATE_LIMIT_DEFAULT_PER_HOUR — дефолтный лимит
 *     не-критических нотификаций в час на пользователя.
 *   - CONVERSATIONAL_EMAIL_FROM_DEFAULT — From-адрес для каналов
 *     email_smtp; если пусто — берётся `MAIL_FROM`.
 *   - CONVERSATIONAL_MAX_DELIVERY_ATTEMPTS — потолок retry'ев outbound-
 *     воркера на одну `NotificationDelivery`.
 */
const ConversationalSchema = z.object({
  CONVERSATIONAL_OUTBOUND_CONCURRENCY: z.coerce.number().int().positive().default(4),
  CONVERSATIONAL_LINK_CODE_TTL_SEC: z.coerce.number().int().positive().default(600),
  CONVERSATIONAL_QUIET_HOURS_DEFAULT: z.string().default('22:00-08:00'),
  CONVERSATIONAL_RATE_LIMIT_DEFAULT_PER_HOUR: z.coerce.number().int().positive().default(10),
  CONVERSATIONAL_EMAIL_FROM_DEFAULT: z.string().default(''),
  CONVERSATIONAL_MAX_DELIVERY_ATTEMPTS: z.coerce.number().int().positive().default(5),
});

/**
 * SBA β-1 — Telegram Bot channel.
 *
 *   - TELEGRAM_BOT_API_BASE — базовый URL Telegram Bot API. Override нужен
 *     для тестов / proxy. По умолчанию — `https://api.telegram.org`.
 *   - TELEGRAM_BOT_GLOBAL_RPS — глобальный rate-limit для outbound-вызовов
 *     Telegram API (Bot API лимит ~30 msg/sec; держим pessimistic 25, чтобы
 *     не словить 429 у соседних tenant'ов).
 *
 * Per-tenant botToken / webhookSecret лежат в `Channel.config` (encrypted).
 * Здесь нет TELEGRAM_BOT_TOKEN — это правильно: токен per-tenant.
 */
const TelegramBotChannelSchema = z.object({
  TELEGRAM_BOT_API_BASE: z.string().url().default('https://api.telegram.org'),
  TELEGRAM_BOT_GLOBAL_RPS: z.coerce.number().int().positive().default(25),
});

/**
 * SBA β-1 — MAX Bot channel (mssgr.ru / dev.max.ru).
 *
 *   - MAX_BOT_API_BASE — базовый URL Platform API. По умолчанию —
 *     `https://platform-api.max.ru` (см. context7 / dev.max.ru/docs-api).
 *   - MAX_BOT_GLOBAL_RPS — глобальный rate-limit (MAX рекомендует ≤30 RPS;
 *     держим pessimistic 25).
 *
 * Per-tenant accessToken / webhookSecret лежат в `Channel.config` (encrypted).
 *
 * SBA β-1 zero-button (2026-05-23): master-флаги bot inbound добавлены в
 * эту же схему (BOT_VOICE_ENABLED / BOT_DOCUMENT_ENABLED /
 * BOT_INTENT_CLASSIFIER_ENABLED), чтобы не превысить лимит TS на глубину
 * `.merge()`-цепочки (TS2589) — см. аналогичный приём в PersonaSchema
 * (Company Foundation). Логически независимы — отдельный геттер
 * `cfg.bot` в TypedConfigService.
 *
 *   - BOT_VOICE_ENABLED — приём voice-сообщений (getFile → ASR → classify
 *     → free_note|chat_query). При false — голос игнорируется с reply
 *     «голос временно недоступен».
 *   - BOT_DOCUMENT_ENABLED — приём документов (PDF/DOCX/MD/TXT → upload
 *     через DocumentsService → document.adapter pipeline). При false —
 *     reply «загрузка файлов сейчас выключена».
 *   - BOT_INTENT_CLASSIFIER_ENABLED — LLM-классификатор intent
 *     (QueryClassifierService). При false → fallback на эвристики.
 *     Также fallback срабатывает, если LLM throw.
 */
const MaxBotChannelSchema = z.object({
  MAX_BOT_API_BASE: z.string().url().default('https://platform-api.max.ru'),
  MAX_BOT_GLOBAL_RPS: z.coerce.number().int().positive().default(25),
  // SBA β-1 zero-button (2026-05-23). Master-flags inbound поведений.
  BOT_VOICE_ENABLED: zBool(true),
  BOT_DOCUMENT_ENABLED: zBool(true),
  BOT_INTENT_CLASSIFIER_ENABLED: zBool(true),
});

/**
 * SBA α-4 — Layer 4 Curation Foundation.
 * Пороги triage'а, expiry, и stale-detection cron'а.
 *
 *   - CURATION_AUTO_THRESHOLD_DEFAULT — confidence >= порога → auto-canonical.
 *   - CURATION_DEEP_REVIEW_THRESHOLD_DEFAULT — confidence < порога → deep review.
 *     Между ними — light review.
 *   - CURATION_CRITICAL_TYPES_DEFAULT — CSV типов, которые всегда идут на deep
 *     review (вне зависимости от confidence). По умолчанию ['regulation',
 *     'process', 'decision'] — самые опасные карточки.
 *   - CURATION_ITEM_EXPIRY_DAYS — через сколько дней `pending` CurationItem
 *     истекает (для stale-карточек — пометка `status='stale'`).
 *   - CARD_STALE_DETECTOR_CRON — расписание ежедневного прохода
 *     CardStaleDetectorCron.
 *   - CARD_STALE_MONTHS_THRESHOLD — порог «давно не подтверждалась»
 *     (`lastConfirmedAt > N мес.`).
 *   - CARD_STALE_DYNAMIC_SCORE_THRESHOLD — порог упавшего `dynamicScore`,
 *     ниже которого карточка считается кандидатом на stale-probe.
 */
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

/**
 * SBA β-2 — Specialist 3.2 Knowledge Clone.
 *
 *   - KNOWLEDGE_CLONE_REBUILD_CRON — расписание `KnowledgeCloneRebuildCron`,
 *     по умолчанию раз в 6 часов.
 *   - KNOWLEDGE_CLONE_LOOKBACK_MONTHS — окно блоков (за сколько месяцев
 *     ищем материал для профиля). По умолчанию 12 месяцев.
 *   - KNOWLEDGE_CLONE_DEBOUNCE_MS — дебаунс enqueue rebuild-job'а
 *     (несколько подряд идущих диспатчей одного Person сложатся в один job).
 *   - KNOWLEDGE_CLONE_MIN_BLOCKS_FOR_PROFILE — порог: если блоков меньше,
 *     профиль не строится (мало материала — выйдет шум).
 *   - KNOWLEDGE_CLONE_EMBEDDING_FALLBACK_THRESHOLD — ТЗ 2026-05-25 Фаза 4.
 *     Если в БД меньше N embedding-строк per Org, getCardsForQuery
 *     откатывается на substring-match (страховка до бэкфилла).
 *   - KNOWLEDGE_CLONE_MIN_MATCH_SCORE — ТЗ 2026-05-25 Фаза 4. Минимальный
 *     суммарный score Person'а (sum similarity*confidenceWeight) для попадания
 *     в результаты. Ниже — отсекается как слабое совпадение.
 */
const KnowledgeCloneSchema = z.object({
  KNOWLEDGE_CLONE_REBUILD_CRON: z.string().min(1).default('0 */6 * * *'),
  KNOWLEDGE_CLONE_LOOKBACK_MONTHS: z.coerce.number().int().positive().default(12),
  KNOWLEDGE_CLONE_DEBOUNCE_MS: z.coerce.number().int().positive().default(60_000),
  KNOWLEDGE_CLONE_MIN_BLOCKS_FOR_PROFILE: z.coerce.number().int().positive().default(10),
  KNOWLEDGE_CLONE_EMBEDDING_FALLBACK_THRESHOLD: z.coerce.number().int().positive().default(5),
  KNOWLEDGE_CLONE_MIN_MATCH_SCORE: z.coerce.number().default(1.0),
});

/**
 * SBA β-4 — Specialist 3.5 (Insights Radar).
 *
 *   - INSIGHT_CLUSTER_THRESHOLD — порог cosine sim для KNN-кластеризации
 *     (>= порога → считаем повтором, обновляем existing Insight).
 *   - INSIGHT_CLUSTER_CRON — расписание `InsightClustererCron`, по умолчанию
 *     раз в 6 часов: пересчёт frequency/dynamic + probe.escalation_suggested.
 *   - INSIGHT_FREQUENCY_WINDOW_DAYS — окно rolling-частоты (default 30д).
 *   - INSIGHT_SPIKE_RATIO — порог ratio 7d/30d, выше которого dynamicLabel='spike'.
 */
const InsightsSchema = z.object({
  INSIGHT_CLUSTER_THRESHOLD: z.coerce.number().min(0).max(1).default(0.78),
  INSIGHT_CLUSTER_CRON: z.string().min(1).default('0 */6 * * *'),
  INSIGHT_FREQUENCY_WINDOW_DAYS: z.coerce.number().int().positive().default(30),
  INSIGHT_SPIKE_RATIO: z.coerce.number().positive().default(3.0),
});

/**
 * SBA β-5 — Specialist 3.6 (Ideas Collector).
 *
 *   - IDEA_CLUSTER_THRESHOLD — порог cosine sim для KNN-дедупа Idea (>= порога
 *     → обновляем existing).
 *   - IDEA_CLUSTERER_CRON — расписание `IdeaClustererCron` (group Idea →
 *     IdeaCluster, обновление clusterWeight). По умолчанию каждые 4 часа.
 *   - IDEA_MIN_SUPPORTERS_FOR_CLUSTER — минимум идей для создания нового
 *     IdeaCluster (порог критической массы).
 */
const IdeasSchema = z.object({
  IDEA_CLUSTER_THRESHOLD: z.coerce.number().min(0).max(1).default(0.80),
  IDEA_CLUSTERER_CRON: z.string().min(1).default('30 */4 * * *'),
  IDEA_MIN_SUPPORTERS_FOR_CLUSTER: z.coerce.number().int().positive().default(2),
});

/**
 * SBA β-5 — Layer 6 Probe-Agent.
 *
 *   - PROBE_DEDUP_TTL_HOURS — TTL Redis-кеша дедупа по contentHash.
 *   - PROBE_RATE_LIMIT_PER_USER_PER_HOUR / _PER_DAY — анти-спам limits.
 *   - PROBE_EXPIRY_DAYS — через сколько дней probe считается expired.
 *   - PROBE_PRIORITY_REFRESH_CRON — расписание пересчёта engagement_rate.
 *   - PROBE_QUIET_HOURS_DEFAULT_TZ_OFFSET_MIN — дефолтное смещение TZ
 *     получателя (MSK = +180 мин). Локализация per-user — γ+.
 *   - PROBE_COLD_START_MODE_HOURS — окно «прогрева» после deploy/old probe:
 *     первые N часов после первого probe в Org все probe идут только в admin-
 *     очередь (status='dropped_cold_start'), не в каналы.
 */
const ProbeSchema = z.object({
  PROBE_DEDUP_TTL_HOURS: z.coerce.number().int().positive().default(72),
  PROBE_RATE_LIMIT_PER_USER_PER_HOUR: z.coerce.number().int().positive().default(5),
  PROBE_RATE_LIMIT_PER_USER_PER_DAY: z.coerce.number().int().positive().default(20),
  PROBE_EXPIRY_DAYS: z.coerce.number().int().positive().default(14),
  PROBE_PRIORITY_REFRESH_CRON: z.string().min(1).default('*/15 * * * *'),
  PROBE_QUIET_HOURS_DEFAULT_TZ_OFFSET_MIN: z.coerce.number().int().default(180),
  PROBE_COLD_START_MODE_HOURS: z.coerce.number().int().min(0).default(24),
});

/**
 * SBA γ-1 — Specialist 3.7 (SkillProfile + ExecutablePersona) + Clone API.
 *
 *   - SKILL_MIN_OBSERVATIONS — минимум наблюдений для появления trait (default 5).
 *   - SKILL_TRAIT_SIMILARITY_THRESHOLD — KNN-cosine порог merge (default 0.85).
 *   - SKILL_LOOKBACK_MONTHS — окно поиска subject-reasoning блоков (default 12).
 *   - SKILL_DECAY_MONTHS — без подтверждений N мес → confidence↓ (default 6).
 *   - SKILL_ARCHIVE_MONTHS — без подтверждений N мес → status='archived' (default 12).
 *   - SKILL_RECALIBRATE_CRON — расписание daily decay-cron'а.
 *   - SKILL_MANAGER_DIGEST_CRON — расписание weekly manager-дайджеста.
 *   - CLONE_ASK_PER_USER_PER_DAY — rate limit запросов к Clone API.
 */
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
  // ── ТЗ 2026-05-25 clone-reliability-hardening, Фаза 1 (антифальшивка) ──
  /**
   * Порог семантической близости вопроса к reasoning-блоку: ниже этого —
   * блок считается «не по теме». Default 0.70.
   */
  CLONE_TOPIC_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.70),
  /**
   * Минимум reasoning-блоков «по теме», чтобы клон отвечал. Если меньше —
   * программный отказ ДО вызова модели (анти-deepfake). Default 2.
   */
  CLONE_TOPIC_MIN_BLOCKS: z.coerce.number().int().positive().default(2),
  // ── ТЗ 2026-05-25 clone-reliability-hardening, Фаза 5 (реактивный rebuild) ──
  /**
   * Сколько новых/замещённых SkillTrait за последние 24ч триггерит
   * внеочередной rebuild ExecutablePersona. Default 2.
   */
  PERSONA_REBUILD_TRAIT_DELTA_THRESHOLD: z.coerce.number().int().positive().default(2),
  /**
   * Максимальный возраст активного ExecutablePersona snapshot в часах —
   * после превышения rebuild ставится даже без новых черт. Default 48.
   */
  PERSONA_REBUILD_MAX_AGE_HOURS: z.coerce.number().int().positive().default(48),
  // ── ТЗ 2026-05-25 clone-reliability-hardening, Фаза 2 (смысловые блоки) ──
  /**
   * Порог cosine similarity для совпадения новой черты с существующим
   * SkillTraitConcept. similarity >= 0.85 → берём существующий концепт,
   * иначе создаём новый. Default 0.85.
   */
  CLONE_CONCEPT_MATCH_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),
  /**
   * Порог cosine similarity для слияния двух активных SkillTraitConcept
   * в cron-нормализаторе. Выше порога создания (0.85), потому что слияние
   * деструктивно — должно быть очень уверенным. Default 0.92.
   */
  CLONE_CONCEPT_MERGE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.92),
  /**
   * Сколько месяцев SkillTraitConcept может быть без активных traits до
   * архивации в cron-нормализаторе. Default 6.
   */
  CLONE_CONCEPT_ARCHIVE_AFTER_MONTHS: z.coerce
    .number()
    .int()
    .positive()
    .default(6),
});

/**
 * SBA α-7 wave 2 — Specialist 3.1 ProcessTemplate detector + completeness.
 *
 *   - PROCESS_DETECTOR_BATCH_SIZE — порог числа блоков, при достижении которого
 *     батч process-detector сбрасывается на LLM-извлечение (default 10).
 *   - PROCESS_DETECTOR_BATCH_TIMEOUT_SECONDS — таймаут окна (default 300 = 5 мин);
 *     если за окно блоков накопилось меньше batchSize — всё равно flush.
 *   - PROCESS_TEMPLATE_COMPLETENESS_CRON — расписание ежедневного пересчёта
 *     completeness для всех ProcessTemplate (default 03:00 UTC).
 *   - PROCESS_TEMPLATE_DEDUPE_THRESHOLD — cosine similarity порог склейки
 *     при extract'е (>= порога → новая ProcessTemplateVersion existing template'а).
 */
const ProcessTemplateSchema = z.object({
  PROCESS_DETECTOR_BATCH_SIZE: z.coerce.number().int().positive().default(10),
  PROCESS_DETECTOR_BATCH_TIMEOUT_SECONDS: z
    .coerce.number()
    .int()
    .positive()
    .default(300),
  PROCESS_TEMPLATE_COMPLETENESS_CRON: z.string().min(1).default('0 3 * * *'),
  PROCESS_TEMPLATE_DEDUPE_THRESHOLD: z
    .coerce.number()
    .min(0)
    .max(1)
    .default(0.85),
  /// SBA γ-3 — мастер-флаг детектора cross-functional. False → детектор
  /// не пересчитывает score / не выставляет isCrossFunctional при create/update.
  CROSS_FUNCTIONAL_DETECTOR_ENABLED: zBool(true),
  /// SBA γ-3 — порог `unique_departments / total_steps`. >= порога →
  /// `isCrossFunctional=true`.
  CROSS_FUNCTIONAL_SCORE_THRESHOLD: z
    .coerce.number()
    .min(0)
    .max(1)
    .default(0.5),
});

/**
 * SBA α-5 dialog-layer — препроцессор chat-v2 (Contextualizer / Confidence /
 * Classifier / MultiQuery / Summarizer + AnswerCache/RetrievalCache).
 * См. plans/tz/2026-05-23-sba-alpha-5-dialog-layer-and-cache.md §13.
 *
 *   - DIALOG_LAYER_ENABLED — master-флаг. False → fallback на raw userMessage.
 *   - ANSWER_CACHE_TTL_SECONDS — TTL финального ответа (24h по умолчанию).
 *   - RETRIEVAL_CACHE_TTL_SECONDS — TTL blockIds (1h по умолчанию).
 *   - CONTEXTUALIZER_CONFIDENCE_MIN — порог confidence ниже которого
 *     fallback на raw userMessage.
 *   - SUMMARIZER_MESSAGE_THRESHOLD — порог числа messages, при котором
 *     ConversationSummarizerCron сжимает старую часть в summary.
 *   - MULTI_QUERY_EXPANSION_ENABLED — мастер-флаг 3-way query expansion
 *     (для exploratory/analytical intent).
 *   - DIALOG_SUMMARIZER_CRON — cron для запуска summarizer'а (по умолчанию
 *     каждые 30 минут).
 *   - DIALOG_SUMMARIZER_KEEP_LAST — сколько последних сообщений оставлять
 *     "сырыми" (после summary).
 *   - DIALOG_SUMMARIZER_STALENESS_HOURS — через сколько часов summary
 *     считается устаревшим и пересчитывается.
 */
const DialogLayerSchema = z.object({
  DIALOG_LAYER_ENABLED: zBool(true),
  ANSWER_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
  RETRIEVAL_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(3_600),
  CONTEXTUALIZER_CONFIDENCE_MIN: z.coerce.number().min(0).max(1).default(0.5),
  SUMMARIZER_MESSAGE_THRESHOLD: z.coerce.number().int().positive().default(12),
  MULTI_QUERY_EXPANSION_ENABLED: zBool(true),
  DIALOG_SUMMARIZER_CRON: z.string().min(1).default('*/30 * * * *'),
  DIALOG_SUMMARIZER_KEEP_LAST: z.coerce.number().int().positive().default(6),
  DIALOG_SUMMARIZER_STALENESS_HOURS: z.coerce.number().int().positive().default(12),
});

/**
 * SBA β-6 — Experiment Tracker (Specialist 3.9).
 *
 *   - EXPERIMENT_AUTO_STATUS_TRANSITION_ENABLED — мастер-флаг автоперевода
 *     статусов экспериментов в `experiment-status-resolver.cron`. При false —
 *     cron работает в no-op режиме (только метрики, без UPDATE). По умолчанию
 *     true (см. β-6 §13).
 *   - EXPERIMENT_RUNNING_PROBE_THRESHOLD_DAYS — порог дней без результата для
 *     probe `experiment.running_too_long`. По умолчанию 30 (см. β-6 §2).
 *
 * Группа добавлена отдельно (β-6 §13). Параметры читаются через
 * `TypedConfigService.experiments` (см. typed-config.ts).
 *
 * NB: SBA γ-2 (Concierge) ENV-ключи добавлены в ту же группу через
 * .merge() ниже — отдельный геттер `cfg.concierge`. Это снижает глубину
 * .merge цепочки EnvSchema (см. NB про TS2589 выше).
 */
const ExperimentSchema = z.object({
  // EXPERIMENT_* keys и CONCIERGE_* keys (SBA γ-2) теперь живут в PersonaSchema
  // ниже — это снижает глубину .merge цепочки и помогает обходить TS2589
  // (см. NB перед EnvSchema). Эта схема сохранена пустой как placeholder для
  // возможного будущего расширения.
});

/**
 * SBA γ-1 — ExecutablePersona build cron + параметры компиляции.
 *
 *   - PERSONA_BUILD_CRON — расписание сборки snapshots (по умолчанию воскресенье 06:00).
 *   - PERSONA_MIN_TRAITS — минимум активных traits в SkillProfile для появления Persona.
 *   - PERSONA_ROLE_AGG_MIN_PERSONS — минимум employee'ев с активным профилем для role-persona.
 */
const PersonaSchema = z.object({
  PERSONA_BUILD_CRON: z.string().min(1).default('0 6 * * SUN'),
  PERSONA_MIN_TRAITS: z.coerce.number().int().positive().default(3),
  PERSONA_ROLE_AGG_MIN_PERSONS: z.coerce.number().int().positive().default(2),
  /// SBA γ-1 доделки — мастер-тумблер weekly snapshot. true = собирается
  /// каждый понедельник 06:00 (или по PERSONA_BUILD_CRON). false = только
  /// trigger-based и manual snapshot.
  EXECUTABLE_PERSONA_SCHEDULED_REBUILD_ENABLED: zBool(true),
  /// SBA γ-1 доделки — порог числа новых active traits с момента последнего
  /// snapshot, при достижении которого trigger-watcher cron инициирует rebuild.
  EXECUTABLE_PERSONA_THRESHOLD_TRAITS_COUNT: z.coerce.number().int().positive().default(3),
  /// SBA γ-1 доделки — минимальный интервал (минуты) между двумя rebuild'ами
  /// одной persona. Защита от дёрганья: если уже собрали < N минут назад — skip.
  EXECUTABLE_PERSONA_MIN_REBUILD_INTERVAL_MINUTES: z.coerce
    .number()
    .int()
    .positive()
    .default(60),

  // SBA α-9 wave 3 — Company Foundation (DomainExpander / MaturityScorer).
  // Сложены в PersonaSchema, чтобы не превысить лимит TS на глубину типов
  // (см. комментарий перед EnvSchema). Логически независимы — см.
  // typed-config.ts (`cfg.companyFoundation`).
  DOMAIN_EXPANDER_ENABLED: zBool(true),
  DOMAIN_EXPANDER_MIN_CLUSTER_SIZE: z.coerce.number().int().positive().default(10),
  DOMAIN_EXPANDER_MAX_NEW_PER_RUN: z.coerce.number().int().positive().default(5),
  MATURITY_SCORER_ENABLED: zBool(true),

  // SBA β-7 — Brand Voice Curator (Specialist 3.10).
  // Сложены в PersonaSchema по той же причине (TS2589 при ≥30 .merge цепочках).
  // Логически независимы — см. typed-config.ts (`cfg.brandVoice`).
  //
  //   - BRAND_VOICE_EXTRACTOR_ENABLED — мастер-флаг daily-cron'а извлечения
  //     профиля. False → cron работает в no-op режиме (для прода первой
  //     недели после деплоя).
  //   - BRAND_VOICE_MIN_CORPUS_SIZE — минимум документов с useCases includes
  //     'brand_corpus', ниже которого экстрактор пропускает Org (anti-noise).
  BRAND_VOICE_EXTRACTOR_ENABLED: zBool(true),
  BRAND_VOICE_MIN_CORPUS_SIZE: z.coerce.number().int().positive().default(5),

  // SBA β-6 — Experiment Tracker (Specialist 3.9).
  // Сложены в PersonaSchema по той же причине (TS2589 при ≥30 .merge цепочках).
  // Логически независимы — см. typed-config.ts (`cfg.experiments`).
  //
  //   - EXPERIMENT_AUTO_STATUS_TRANSITION_ENABLED — мастер-флаг автоперевода
  //     статусов в `experiment-status-resolver.cron`. При false — cron только
  //     считает метрики и эмитит probe, без UPDATE статусов.
  //   - EXPERIMENT_RUNNING_PROBE_THRESHOLD_DAYS — порог дней без результата
  //     для probe `experiment.running_too_long`.
  EXPERIMENT_AUTO_STATUS_TRANSITION_ENABLED: zBool(true),
  EXPERIMENT_RUNNING_PROBE_THRESHOLD_DAYS: z.coerce
    .number()
    .int()
    .positive()
    .default(30),

  // SBA γ-2 — Concierge Agent. CONCIERGE_* ENV-ключи НЕ добавлены в
  // EnvSchema (избегаем углубления .merge цепочки → TS2589). Читаются
  // через process.env в TypedConfigService.concierge с runtime-fallback на
  // defaults (100/3000/15s) и `CONCIERGE_ENABLED!==false`. См.
  // plans/tz/2026-05-23-sba-gamma-2-concierge-agent.md §13.

});

/**
 * SBA β-8 (2026-05-23) — DailyCheckIn + OperationsDashboard.
 *
 *   - DAILY_CHECKIN_ENABLED — мастер-флаг cron'а. False → cron работает в
 *     no-op режиме (для прода первой недели после деплоя или временного
 *     отключения с минимальным риском кэшей).
 *   - DAILY_CHECKIN_MORNING_LOCAL_HOUR / DAILY_CHECKIN_EVENING_LOCAL_HOUR
 *     — час локальной TZ Person'а, при достижении которого cron инициирует
 *     morning / evening check-in (default 9 / 18). Окно ±30 мин — внутри
 *     воркера; cron сам тикает каждый час (`0 * * * *`).
 *   - OPERATIONS_DASHBOARD_CACHE_TTL_SECONDS — TTL Redis-кэша COO-агрегата
 *     `/api/v1/dashboard/operations/overview` (default 300с = 5 мин).
 *
 * Логически независимая группа, но регистрируется отдельным `.merge()`-вызовом
 * (т.к. parseEnv возвращает Record<string, unknown> — TS2589 не триггерится).
 * См. typed-config.ts (`cfg.betaOps`).
 */
const BetaOpsSchema = z.object({
  DAILY_CHECKIN_ENABLED: zBool(true),
  DAILY_CHECKIN_MORNING_LOCAL_HOUR: z.coerce
    .number()
    .int()
    .min(0)
    .max(23)
    .default(9),
  DAILY_CHECKIN_EVENING_LOCAL_HOUR: z.coerce
    .number()
    .int()
    .min(0)
    .max(23)
    .default(18),
  OPERATIONS_DASHBOARD_CACHE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(300),

  // SBA β-8.1 — добивка панели операционного директора.
  //   - COO_SENTIMENT_ENABLED — мастер-флаг анализа настроения чек-ина.
  //   - COO_WEEKLY_DIGEST_ENABLED — мастер-флаг недельной сводки.
  //   - COO_WEEKLY_DIGEST_LOCAL_HOUR — час понедельника в локальной TZ Org'а
  //     (default 8). Cron тикает каждый час; фильтр по часу — внутри.
  //   - COO_WEEKLY_DIGEST_LOCAL_DAY — день недели (0=воскресенье,
  //     1=понедельник, default 1).
  COO_SENTIMENT_ENABLED: zBool(true),
  COO_WEEKLY_DIGEST_ENABLED: zBool(true),
  COO_WEEKLY_DIGEST_LOCAL_HOUR: z.coerce
    .number()
    .int()
    .min(0)
    .max(23)
    .default(8),
  COO_WEEKLY_DIGEST_LOCAL_DAY: z.coerce
    .number()
    .int()
    .min(0)
    .max(6)
    .default(1),

  // SBA β-8.3 — ежедневный отчёт COO (`DailyOperationsDigest`).
  //   - COO_DAILY_DIGEST_ENABLED — мастер-флаг cron'а (ENV-fallback;
  //     основной источник — AdminSetting `operations.daily_digest.enabled`).
  //   - COO_DAILY_DIGEST_DELIVER_TO_TELEGRAM — тумблер рассылки в Telegram
  //     (ENV-fallback; основной — AdminSetting `operations.daily_digest.deliver_to_telegram`).
  //     Default false, чтобы Telegram не молотил сразу после раскатки.
  //   - COO_DAILY_DIGEST_HOUR_UTC — час cron'а в UTC (default 22 = 01:00 МСК).
  //     Cron статичен `@Cron('0 22 * * *')`; этот ENV — справочный и для
  //     возможного override-аннотации в будущем.
  COO_DAILY_DIGEST_ENABLED: z.coerce.boolean().default(true),
  COO_DAILY_DIGEST_DELIVER_TO_TELEGRAM: z.coerce.boolean().default(false),
  COO_DAILY_DIGEST_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(22),

  // SBA β-8.2 — «Хранитель обещаний».
  //   - COMMITMENT_FOLLOWUP_ENABLED — мастер-флаг cron'а.
  //   - COMMITMENT_FOLLOWUP_LOCAL_HOUR — час локальной TZ Org'а (default 9).
  //   - COMMITMENT_FALLBACK_DUE_WORKDAYS — fallback срок если не извлечён
  //     LLM из текста обещания (default 5 рабочих дней).
  //   - COMMITMENT_ESCALATION_DAYS — через сколько дней молчания эскалировать
  //     COO/owner (default 3 календарных дня).
  //   - COMMITMENT_MAX_RETRIES — сколько раз спрашивать одного человека
  //     (default 2, фактически: первый probe + один retry; дальше эскалация).
  COMMITMENT_FOLLOWUP_ENABLED: zBool(true),
  COMMITMENT_FOLLOWUP_LOCAL_HOUR: z.coerce
    .number()
    .int()
    .min(0)
    .max(23)
    .default(9),
  COMMITMENT_FALLBACK_DUE_WORKDAYS: z.coerce
    .number()
    .int()
    .positive()
    .default(5),
  COMMITMENT_ESCALATION_DAYS: z.coerce
    .number()
    .int()
    .positive()
    .default(3),
  COMMITMENT_MAX_RETRIES: z.coerce
    .number()
    .int()
    .positive()
    .default(2),

  // ── SBA δ-3 — VoiceChannelAdapter (voice inbound + TTS outbound) ─────
  // См. plans/tz/2026-05-23-sba-delta-3-voice-channel-adapter.md §13.
  // Сложены в BetaOpsSchema (а не отдельной .merge цепочкой), чтобы не
  // удлинять `.merge` цепочку EnvSchema — TS2589 на ней уже за пределом
  // (это deferred-tax от других параллельных групп; см. typed-config.ts).
  // Логически независимы — `cfg.voice`.
  //
  //   - TTS_PROVIDER — `openai` (default) | `yandex` (опц., MVP не активен;
  //     требует отдельного ENV YANDEX_SPEECHKIT_API_KEY).
  //   - TTS_VOICE — дефолтный голос для OpenAI TTS (alloy / echo / fable /
  //     onyx / nova / shimmer). Per-call можно override.
  //   - VOICE_WS_ENABLED — мастер-флаг WS endpoint'а concierge voice.
  //     На δ-3 фактический WS-handler не создан (γ-2 Concierge модуль в
  //     работе). Флаг зарезервирован.
  // NB: TTS_PROVIDER — z.string() (а не z.enum), runtime-валидация в
  // `TtsService.synthesize`, чтобы не наращивать литералы в z.infer<Env>.
  TTS_PROVIDER: z.string().min(1).default('openai'),
  TTS_VOICE: z.string().min(1).default('alloy'),
  VOICE_WS_ENABLED: zBool(true),

  // ── SBA δ-2 — ProactiveWatcher (2026-05-23) ─────────────────────────
  // См. plans/tz/2026-05-23-sba-delta-2-proactive-watcher.md §13.
  // Сложены в BetaOpsSchema, чтобы не удлинять .merge цепочку EnvSchema
  // (TS2589 — см. NB перед EnvSchema). Логически независимы — `cfg.proactive`.
  //
  //   - PROACTIVE_WATCHER_ENABLED — мастер-флаг cron'а. False → no-op.
  //   - PROACTIVE_WATCHER_ANTI_SPAM_TTL_HOURS — TTL Redis dedup-key (default 24).
  //   - PROACTIVE_RULE_*_ENABLED — per-rule тумблер (admin может отключать
  //     отдельные правила без рестарта).
  PROACTIVE_WATCHER_ENABLED: zBool(true),
  PROACTIVE_WATCHER_ANTI_SPAM_TTL_HOURS: z.coerce
    .number()
    .int()
    .positive()
    .default(24),
  PROACTIVE_RULE_DECISION_NO_OWNER_ENABLED: zBool(true),
  PROACTIVE_RULE_INSIGHT_NO_MITIGATION_ENABLED: zBool(true),
  PROACTIVE_RULE_EXPERIMENT_RUNNING_TOO_LONG_ENABLED: zBool(true),
  PROACTIVE_RULE_PROCESS_STALE_REVIEW_ENABLED: zBool(true),
  PROACTIVE_RULE_ROLE_LOW_COMPLETENESS_ENABLED: zBool(true),
  PROACTIVE_RULE_DEPARTMENT_NO_DOMAIN_ENABLED: zBool(true),
  PROACTIVE_RULE_INSIGHTS_SILOED_IN_DOMAIN_ENABLED: zBool(true),
  PROACTIVE_RULE_PLAN_ITEM_OVERDUE_ENABLED: zBool(true),

  // ── β-9 — Глобальный Telegram-бот + GitHub-style приглашения (2026-05-25) ───
  // См. plans/tz/2026-05-25-telegram-bot-global-and-invites.md §13.
  // Сложены в BetaOpsSchema, чтобы не удлинять .merge цепочку EnvSchema
  // (TS2589 — см. NB перед EnvSchema). Логически независимы — `cfg.invites`.
  //
  //   - KORA_BOT_USERNAME — имя глобального Telegram-бота без `@` для построения
  //     deep-link'а `https://t.me/<KORA_BOT_USERNAME>?start=<code>` в письме
  //     приглашения.
  //   - INVITE_TTL_DAYS — срок жизни одного приглашения (default 14 — продлили
  //     с 7 в рамках β-9 для линейного персонала, который проверяет почту реже).
  //   - INVITE_REMINDER_DAYS — на какой день после createdAt отправлять
  //     напоминание сотруднику (default 7).
  //   - MAGIC_LINK_TTL_MINUTES — TTL одноразовой ссылки входа без пароля
  //     (default 15 — короткий, потому что magic-link открывает сессию).
  //   - MAGIC_LINK_RATE_LIMIT_PER_HOUR — защита от спама запросами magic-link
  //     на одну электронную почту (default 5).
  //   - INACTIVE_BINDING_DAYS — через сколько дней привязки с заблокированным
  //     ботом сотрудник переводится в `inactive` (default 30).
  KORA_BOT_USERNAME: z.string().min(1).default('kora_bot'),
  INVITE_TTL_DAYS: z.coerce.number().int().positive().default(14),
  INVITE_REMINDER_DAYS: z.coerce.number().int().positive().default(7),
  MAGIC_LINK_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  MAGIC_LINK_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(5),
  INACTIVE_BINDING_DAYS: z.coerce.number().int().positive().default(30),
});

/**
 * SBA α-10 wave 3 — Admin LLM + Unit Economics ENV (budget alerts, currency
 * sync from ЦБ РФ, provider smoke-tests, LLM adapter registry feature-flag).
 * Логически независимая группа, регистрируется отдельным `.merge()`-вызовом
 * (см. `cfg.budget` в typed-config.ts).
 */
const BudgetSchema = z.object({
  BUDGET_ALERT_ENABLED: zBool(true),
  /** Список порогов % через запятую, например "50,80,100". */
  BUDGET_ALERT_THRESHOLD_PERCENTS: z.string().default('80,100'),
  CURRENCY_RATE_API_URL: z
    .string()
    .url()
    .default('https://www.cbr-xml-daily.ru/daily_json.js'),
  CURRENCY_RATE_FALLBACK_USD_RUB: z.coerce.number().positive().default(90),
  PROVIDER_SMOKE_TEST_ENABLED: zBool(true),
  PROVIDER_SMOKE_TEST_INTERVAL_MINUTES: z.coerce
    .number()
    .int()
    .positive()
    .default(30),
  /** Количество подряд провалов до алерта on-call. */
  PROVIDER_SMOKE_TEST_FAIL_THRESHOLD: z.coerce
    .number()
    .int()
    .positive()
    .default(3),
  /**
   * Feature-flag: false → legacy switch(provider) в LlmRouterService.dispatch()
   * (default, production safety). true → LlmProtocolAdapterRegistry.
   * См. plans/tz/2026-05-23-sba-alpha-10-wave3-admin-llm-economics.md §3.5.
   */
  USE_PROTOCOL_ADAPTER_REGISTRY: zBool(false),
});

/**
 * Tracker (Sprint 1 — 2026-05-23-tracker-phase-1-models-api.md §"Метрики
 * Prometheus" + §"Webhooks Out").
 *
 *   - WEBHOOK_HMAC_PREFIX — префикс, который добавляется к base64-секрету
 *     при генерации webhook'а трекера. Через ENV — чтобы при ротации
 *     префикса (например `kora_wh_` → `kora2_wh_`) старые webhook'и
 *     остались валидны до миграции.
 *   - TRACKER_INGEST_QUEUE — имя BullMQ-очереди, в которую tracker
 *     публикует события (`task_created`, `task_status_changed`, ...) для
 *     ingest'а в knowledge-core. Должно совпадать с consumer'ом в
 *     knowledge-core (по умолчанию `core.raw-events`).
 *   - IDEMPOTENCY_KEY_TTL_SECONDS — TTL Redis-кэша Idempotency-Key для
 *     POST /api/v1/tracker/* (default 24ч, по RFC draft idempotency-keys).
 *   - TRACKER_WEBHOOK_MAX_RETRIES — потолок повторов доставки webhook'а
 *     трекера. После исчерпания — `WebhookDelivery.status='failed'`.
 *   - TRACKER_WEBHOOK_RETRY_BACKOFF_INITIAL_MS — начальная задержка перед
 *     первым retry (последующие — экспоненциально, фактор задаёт consumer).
 *
 * Логически независимая группа, регистрируется отдельным `.merge()`-вызовом
 * (см. typed-config.ts → `cfg.tracker`). Короткие schemas с `parseEnv:
 * Record<string, unknown>` TS2589 не триггерят (см. NB перед EnvSchema).
 */
const TrackerSchema = z.object({
  WEBHOOK_HMAC_PREFIX: z.string().min(1).default('kora_wh_'),
  TRACKER_INGEST_QUEUE: z.string().min(1).default('core.raw-events'),
  IDEMPOTENCY_KEY_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
  TRACKER_WEBHOOK_MAX_RETRIES: z.coerce.number().int().positive().default(5),
  TRACKER_WEBHOOK_RETRY_BACKOFF_INITIAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(60_000),
});

/**
 * Полная схема — слияние всех групп.
 *
 * NB (cardinality / TS2589): TypeScript падает на бесконечной глубине типов
 * при ≥30 `.merge()`-вызовах. Поэтому новые ENV-ключи Company Foundation
 * (DOMAIN_EXPANDER_*, MATURITY_SCORER_*) добавлены прямо в PersonaSchema
 * выше, а не отдельной схемой. Это снижает глубину типа Env. После γ-1
 * `parseEnv` возвращает `Record<string, unknown>` — поэтому короткая цепочка
 * `.merge(BetaOpsSchema)` ниже безопасна.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const EnvSchema: z.ZodTypeAny = (RuntimeSchema as unknown as any).merge(DatabaseSchema)
  .merge(RedisSchema)
  .merge(AuthSchema)
  .merge(ArgonSchema)
  .merge(MailSchema)
  .merge(LiveKitSchema)
  .merge(TurnSchema)
  .merge(S3Schema)
  .merge(AnthropicSchema)
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
  .merge(TelegramBotChannelSchema)
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
  // NB (TS2589): объединяем BetaOps + Voice в один merge-шаг, чтобы
  // не наращивать длину `.merge` цепочки EnvSchema. Логически независимы
  // (`cfg.betaOps`, `cfg.voice`, `cfg.roleMap`).
  .merge(BetaOpsSchema)
  .merge(BudgetSchema)
  .merge(TrackerSchema);

export type Env = z.infer<typeof EnvSchema>;

/**
 * Парсер ENV. Используется в `ConfigModule.forRoot({ validate })`.
 * При ошибке — формирует читаемое сообщение и пробрасывает.
 *
 * NB: возвращаемый тип — `Record<string, unknown>` (а не `Env`), чтобы
 * NestConfigModule.forRoot.validate не триггерил TS2589 на длинной
 * .merge-цепочке EnvSchema (~50 разделов). Типизация значений — на уровне
 * `TypedConfigService.get` через runtime-cast.
 */
export function parseEnv(raw: Record<string, unknown>): Record<string, unknown> {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Невалидная конфигурация ENV. Проверь .env (см. .env.example).\n${issues}`,
    );
  }
  return result.data as unknown as Record<string, unknown>;
}
