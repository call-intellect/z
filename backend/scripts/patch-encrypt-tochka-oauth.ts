/**
 * audit Б5 (2026-05-29) — миграция plain-токенов Tochka OAuth на AES-256-GCM
 * конверт. До этого фикса `BillingProviderConfig.valueJson` хранил
 * `{accessToken, refreshToken, ...}` в открытом виде — дамп БД давал
 * прямой доступ к API Точки.
 *
 * Что делает:
 *   1. Берёт `BillingProviderConfig` с ключом 'tochka.production.oauth_tokens'
 *      (или любой по фильтру `LIKE 'tochka%oauth_tokens'`).
 *   2. Если `valueJson` уже содержит `{ enc: 'gcm:v1:...' }` — пропускает (idempotent).
 *   3. Иначе шифрует через `CryptoService.encrypt(JSON.stringify(value))` и
 *      пишет `{ enc: '<encrypted>' }` обратно.
 *
 * ВАЖНО: bun-скрипт; CryptoService мы не можем инжектить через Nest, поэтому
 * импортируем класс напрямую и собираем вручную с заглушкой `cfg`.
 *
 * Запуск:
 *   docker compose exec backend bun run scripts/patch-encrypt-tochka-oauth.ts
 *   docker compose exec backend bun run scripts/patch-encrypt-tochka-oauth.ts --dry-run
 *
 * Зарегистрирован в `apply-prod-deploy.ts` STEPS (phase: 'patch', skipBootstrap: true).
 */

import { CryptoService } from '../src/common/crypto/crypto.service';

import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

const KEY_PREFIX = 'tochka.';
const KEY_SUFFIX = '.oauth_tokens';

interface CliOptions {
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { dryRun: false };
  for (const arg of argv) {
    if (arg === '--dry-run') opts.dryRun = true;
  }
  return opts;
}

/**
 * Stub TypedConfigService: единственное поле, которое использует CryptoService,
 * — `cfg.crypto.masterKey`. Читаем из ENV напрямую.
 */
function makeCfgStub(): { crypto: { masterKey: string } } {
  const raw = process.env['CRYPTO_MASTER_KEY'] ?? '';
  if (!raw) {
    throw new Error(
      'patch-encrypt-tochka-oauth: ENV CRYPTO_MASTER_KEY не задан. ' +
        'Шифровать нечем — сначала пропиши ключ в .env.',
    );
  }
  return { crypto: { masterKey: raw } };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log('[audit Б5 encrypt-tochka-oauth] start', { dryRun: opts.dryRun });

  const rows = await prisma.billingProviderConfig.findMany({
    where: {
      AND: [
        { key: { startsWith: KEY_PREFIX } },
        { key: { endsWith: KEY_SUFFIX } },
      ],
    },
  });
  console.log(`[audit Б5 encrypt-tochka-oauth] найдено записей: ${rows.length}`);

  if (rows.length === 0) {
    console.log('[audit Б5 encrypt-tochka-oauth] нечего шифровать');
    return;
  }

  let alreadyEncrypted = 0;
  let toEncrypt = 0;
  for (const row of rows) {
    const v = row.valueJson as unknown;
    if (v && typeof v === 'object' && typeof (v as { enc?: unknown }).enc === 'string') {
      alreadyEncrypted += 1;
      continue;
    }
    toEncrypt += 1;
  }
  console.log(
    `[audit Б5 encrypt-tochka-oauth] enc уже: ${alreadyEncrypted}, plain→encrypt: ${toEncrypt}`,
  );

  // Если всё уже зашифровано — выходим чисто ДО запроса CRYPTO_MASTER_KEY.
  // Иначе на ноде без ключа скрипт падал бы, хотя шифровать нечего —
  // обновление не требуется.
  if (toEncrypt === 0) {
    console.log(
      '[audit Б5 encrypt-tochka-oauth] все токены уже зашифрованы — обновление не требуется',
    );
    return;
  }

  if (opts.dryRun) {
    console.log('[audit Б5 encrypt-tochka-oauth] dry-run: ничего не пишем');
    return;
  }

  // CryptoService требует TypedConfigService → берём stub (запрашивает
  // CRYPTO_MASTER_KEY только когда реально есть что шифровать).
  const cfgStub = makeCfgStub();
  const crypto = new CryptoService(cfgStub as never);

  let updated = 0;
  for (const row of rows) {
    const v = row.valueJson as unknown;
    if (v && typeof v === 'object' && typeof (v as { enc?: unknown }).enc === 'string') {
      continue;
    }
    const encStr = crypto.encrypt(JSON.stringify(v));
    await prisma.billingProviderConfig.update({
      where: { key: row.key },
      data: { valueJson: { enc: encStr } },
    });
    updated += 1;
    console.log(`[audit Б5 encrypt-tochka-oauth] key=${row.key} encrypted`);
  }
  console.log(`[audit Б5 encrypt-tochka-oauth] done. updated=${updated}`);
}

main()
  .catch((err) => {
    console.error('[audit Б5 encrypt-tochka-oauth] ERROR', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
