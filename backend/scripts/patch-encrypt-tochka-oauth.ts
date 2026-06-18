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
      AND: [{ key: { startsWith: KEY_PREFIX } }, { key: { endsWith: KEY_SUFFIX } }],
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
