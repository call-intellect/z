/**
 * Vitest test-environment ENV setup.
 *
 * Подключается через `vitest.config.ts` → `test.setupFiles`.
 * Выставляет минимальные значения для всех обязательных ENV-ключей
 * из `src/common/config/env.schema.ts`, чтобы zod-валидация в `ConfigModule`
 * проходила в test-окружении (где реального `.env` нет).
 *
 * Все значения здесь — фейковые. Реальные секреты живут в `backend/.env`
 * и НИКОГДА не должны попадать в git. Этот файл только для тестов.
 *
 * Если в `env.schema.ts` появляется новый required-ключ — добавить сюда
 * безопасный дефолт. Юнит-тесты с моками `TypedConfigService` не зависят
 * от этих значений.
 */
const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  PORT: '3000',
  LOG_LEVEL: 'silent',

  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',

  JWT_SESSION_SECRET: 'test-session-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  JWT_DEEP_LINK_SECRET: 'test-deeplink-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  COOKIE_DOMAIN: 'localhost',
  PUBLIC_FRONTEND_URL: 'http://localhost:3001',

  LIVEKIT_API_URL: 'http://localhost:7880',
  LIVEKIT_API_KEY: 'test-key',
  LIVEKIT_API_SECRET: 'test-secret',
  LIVEKIT_WEBHOOK_API_KEY: 'test-wh-key',
  LIVEKIT_WEBHOOK_API_SECRET: 'test-wh-secret',

  S3_ENDPOINT_URL: 'http://localhost:9000',
  S3_REGION: 'ru-7',
  S3_BUCKET: 'test-bucket',
  S3_ACCESS_KEY: 'test-access',
  S3_SECRET_KEY: 'test-secret',

  ANTHROPIC_API_KEY: 'test',
  VOX_API_TOKEN: 'test',
  OPENAI_API_KEY: 'test',
  DEEPSEEK_API_KEY: 'test',
  MINIMAX_API_KEY: 'test',
  GRSAI_API_KEY: 'test',
  KIE_API_KEY: 'test',

  // ai-workspace: 32 байта в base64 для AES-GCM-256.
  // Сгенерировано один раз и захардкожено для test-окружения.
  WEBHOOK_SECRETS_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',

  // standalone: SMTP — в test'ах MailService работает в dry-run.
  MAIL_DRY_RUN: 'true',
};

for (const [key, value] of Object.entries(TEST_ENV)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}
