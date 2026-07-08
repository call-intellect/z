#!/usr/bin/env bun
import { existsSync } from 'node:fs';

const SOURCE = '.env';
const TARGET = 'backend/.env';

const overrides: Record<string, string> = {
  NODE_ENV: 'development',
  LOG_LEVEL: 'debug',
  PORT: '4000',
  FRONTEND_PORT: '4001',
  DATABASE_URL: 'postgresql://z_app:z_app_dev_password@127.0.0.1:55435/z_main',
  REDIS_URL: 'redis://127.0.0.1:56381',
  COOKIE_DOMAIN: 'localhost',
  COOKIE_STANDALONE_DOMAIN: 'localhost',
  PUBLIC_FRONTEND_URL: 'http://localhost:4001',
  PUBLIC_HOST_URL: 'http://localhost:4000',
  S3_ENDPOINT_URL: 'http://127.0.0.1:59000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'meetings-dev',
  S3_ACCESS_KEY: 'z_minio_dev',
  S3_SECRET_KEY: 'z_minio_dev_password',
  LIVEKIT_API_URL: 'ws://localhost:7880',
  MAIL_DRY_RUN: 'true',
  TELEGRAM_PROXY_ENABLED: 'false',
};

if (!existsSync(SOURCE)) {
  console.error(`✖ Нет ${SOURCE} в корне — нечего копировать. Заполни прод-.env или возьми .env.example.`);
  process.exit(1);
}

if (existsSync(TARGET) && !process.argv.includes('--force')) {
  console.error(`✖ ${TARGET} уже существует. Перезаписать: bun scripts/make-local-env.ts --force`);
  process.exit(1);
}

const raw = await Bun.file(SOURCE).text();
const lines = raw.split('\n');
const applied = new Set<string>();
const keyRe = /^([A-Z0-9_]+)=/;

const out = lines.map((line) => {
  const m = line.match(keyRe);
  if (!m) return line;
  const key = m[1];
  if (key in overrides) {
    applied.add(key);
    return `${key}=${overrides[key]}`;
  }
  return line;
});

const appended: string[] = [];
for (const [key, value] of Object.entries(overrides)) {
  if (!applied.has(key)) appended.push(`${key}=${value}`);
}
if (appended.length > 0) {
  out.push('', '# --- local dev overrides (appended) ---', ...appended);
}

await Bun.write(TARGET, out.join('\n'));

console.log(`✓ ${TARGET} создан из ${SOURCE}.`);
console.log(`  Переопределено инфраструктурных ключей: ${applied.size}, добавлено: ${appended.length}.`);
console.log(`  NODE_ENV=development, БД=localhost:55435, Redis=localhost:56381, S3=MinIO:59000.`);
console.log(`  AI-ключи и секреты перенесены из ${SOURCE} как есть.`);
