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
 * Полная схема — слияние всех групп.
 */
export const EnvSchema = RuntimeSchema.merge(DatabaseSchema)
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
  .merge(KnowledgeCoreSchema);

export type Env = z.infer<typeof EnvSchema>;

/**
 * Парсер ENV. Используется в `ConfigModule.forRoot({ validate })`.
 * При ошибке — формирует читаемое сообщение и пробрасывает.
 */
export function parseEnv(raw: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Невалидная конфигурация ENV. Проверь .env (см. .env.example).\n${issues}`,
    );
  }
  return result.data;
}
