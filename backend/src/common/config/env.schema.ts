import { z } from 'zod';

/**
 * Полная zod-схема ENV проекта Z.
 * Источник: plans/architecture/2026-05-08-z-architecture.md §6.7 + расширения от владельца.
 *
 * Принципы:
 *  - Все обязательные ключи помечены без default. Падаем на старте, если их нет.
 *  - Числа и булевы значения парсим из строк через z.coerce.
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
  PUBLIC_FRONTEND_URL: z.string().url(),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
  DEEP_LINK_TTL_SECONDS: z.coerce.number().int().positive().default(900),
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
  TURN_TLS: z.coerce.boolean().default(true),
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
  ANTHROPIC_USE_PROXY: z.coerce.boolean().default(false),
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

const CrossmarkSchema = z.object({
  CROSSMARK_HMAC_TIMESTAMP_WINDOW_SECONDS: z.coerce.number().int().positive().default(300),
});

const RetentionSchema = z.object({
  DEFAULT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  RETENTION_CRON: z.string().min(1).default('0 * * * *'),
});

const IdleSchema = z.object({
  IDLE_MEETING_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(15),
  IDLE_MEETING_CRON: z.string().min(1).default('*/1 * * * *'),
});

const QuotasSchema = z.object({
  MAX_PARTICIPANTS_PER_MEETING: z.coerce.number().int().positive().default(10),
  MAX_MEETING_DURATION_HOURS: z.coerce.number().int().positive().default(8),
});

const AdminSchema = z.object({
  ADMIN_BOOTSTRAP_EMAIL: z.string().email().optional(),
  ADMIN_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(43_200),
});

/**
 * Полная схема — слияние всех групп.
 */
export const EnvSchema = RuntimeSchema.merge(DatabaseSchema)
  .merge(RedisSchema)
  .merge(AuthSchema)
  .merge(LiveKitSchema)
  .merge(TurnSchema)
  .merge(S3Schema)
  .merge(AnthropicSchema)
  .merge(VoxSchema)
  .merge(OpenAiSchema)
  .merge(DeepSeekSchema)
  .merge(MiniMaxSchema)
  .merge(GrsAiSchema)
  .merge(KieSchema)
  .merge(ProxySchema)
  .merge(CrossmarkSchema)
  .merge(RetentionSchema)
  .merge(IdleSchema)
  .merge(QuotasSchema)
  .merge(AdminSchema);

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
