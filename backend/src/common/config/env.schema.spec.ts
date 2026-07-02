import { describe, expect, it } from 'vitest';

import { parseEnv } from './env.schema';

const REQUIRED: Record<string, string> = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SESSION_SECRET: 'x'.repeat(32),
  JWT_DEEP_LINK_SECRET: 'y'.repeat(32),
  COOKIE_DOMAIN: 'localhost',
  PUBLIC_FRONTEND_URL: 'https://app.example.com',
  LIVEKIT_API_URL: 'https://livekit.example.com',
  LIVEKIT_API_KEY: 'lk-key',
  LIVEKIT_API_SECRET: 'lk-secret',
  LIVEKIT_WEBHOOK_API_KEY: 'lk-wh-key',
  LIVEKIT_WEBHOOK_API_SECRET: 'lk-wh-secret',
  S3_ENDPOINT_URL: 'https://s3.example.com',
  S3_REGION: 'ru-1',
  S3_BUCKET: 'bucket',
  S3_ACCESS_KEY: 's3-access',
  S3_SECRET_KEY: 's3-secret',
  ANTHROPIC_API_KEY: 'a-key',
  VOX_API_TOKEN: 'vox-token',
  OPENAI_API_KEY: 'oa-key',
  DEEPSEEK_API_KEY: 'ds-key',
  MINIMAX_API_KEY: 'mm-key',
  GRSAI_API_KEY: 'grsai-key',
  KIE_API_KEY: 'kie-key',
  WEBHOOK_SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
};

describe('EnvSchema — zBool не коэрсит off-строки в true', () => {
  it("SPECIALISTS_COMBINED_ENABLED='false' → false (раньше z.coerce.boolean давал true)", () => {
    const parsed = parseEnv({ ...REQUIRED, SPECIALISTS_COMBINED_ENABLED: 'false' });
    expect(parsed['SPECIALISTS_COMBINED_ENABLED']).toBe(false);
  });

  it("SPECIALISTS_COMBINED_ENABLED='0' → false", () => {
    const parsed = parseEnv({ ...REQUIRED, SPECIALISTS_COMBINED_ENABLED: '0' });
    expect(parsed['SPECIALISTS_COMBINED_ENABLED']).toBe(false);
  });

  it("SPECIALISTS_COMBINED_ENABLED='true' → true", () => {
    const parsed = parseEnv({ ...REQUIRED, SPECIALISTS_COMBINED_ENABLED: 'true' });
    expect(parsed['SPECIALISTS_COMBINED_ENABLED']).toBe(true);
  });

  it('SPECIALISTS_COMBINED_ENABLED отсутствует → default true', () => {
    const parsed = parseEnv({ ...REQUIRED });
    expect(parsed['SPECIALISTS_COMBINED_ENABLED']).toBe(true);
  });
});
