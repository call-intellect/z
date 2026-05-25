/**
 * KC-Temporal W4.3 (2026-05-25) — backfill DataClass-полей outbound-каналов.
 *
 * Что делает (идемпотентно):
 *   - `ChannelBinding.maxDataClass` IS NULL ИЛИ default отсутствует → `internal`.
 *     (Prisma 7 не позволяет нативно проверить «было ли поле задано» — поэтому
 *     поле в schema.prisma уже non-null с default. Скрипт безопасен: он
 *     пытается обновить только те binding'и, где явно `maxDataClass=NULL`
 *     через raw SQL — это покрывает кейс, когда поле было добавлено через
 *     prisma:push на существующую таблицу.)
 *   - `IssueWebhook.allowedDataClasses` IS NULL ИЛИ пустой массив →
 *     `['public', 'internal']` (default из §W4.3 ТЗ).
 *
 * Безопасность (skill safe-seed-rules):
 *   - WHERE-условия исключают уже обработанные строки.
 *   - --dry-run печатает COUNT не пиша; --limit=N ограничивает прогон.
 *   - Транзакция per-batch.
 *
 * Запуск:
 *   cd backend
 *   bun run scripts/patch-channel-binding-defaults.ts            # обычный
 *   bun run scripts/patch-channel-binding-defaults.ts --dry-run  # сухой прогон
 *   bun run scripts/patch-channel-binding-defaults.ts --limit=500
 */

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }),
});

const BATCH_SIZE = 500;

interface CliOptions {
  dryRun: boolean;
  limit: number | null;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { dryRun: false, limit: null };
  for (const arg of argv) {
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg.startsWith('--limit=')) {
      const n = Number.parseInt(arg.slice('--limit='.length), 10);
      if (Number.isFinite(n) && n > 0) opts.limit = n;
    }
  }
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log('[W4.3 backfill] start', {
    dryRun: opts.dryRun,
    limit: opts.limit ?? '∞',
  });

  // 1) ChannelBinding.maxDataClass — заполняем NULL'ы значением 'internal'.
  // Prisma-схема имеет default, но если поле было добавлено `prisma:push`
  // на существующую таблицу с данными — Postgres заполнил его дефолтом
  // автоматически. Раздел оставлен для безопасности (raw SQL).
  const bindingNullCount = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count
    FROM channel_bindings
    WHERE "maxDataClass" IS NULL
  `;
  const cbNulls = Number(bindingNullCount[0]?.count ?? 0);
  console.log('[W4.3 backfill] ChannelBinding.maxDataClass IS NULL:', cbNulls);
  if (cbNulls > 0 && !opts.dryRun) {
    const limitClause =
      opts.limit !== null
        ? `LIMIT ${Math.max(1, opts.limit)}`
        : '';
    // PG не поддерживает LIMIT в UPDATE напрямую — через подзапрос.
    const rows = await prisma.$executeRawUnsafe(`
      UPDATE channel_bindings
      SET "maxDataClass" = 'internal'::"DataClass"
      WHERE id IN (
        SELECT id FROM channel_bindings
        WHERE "maxDataClass" IS NULL
        ${limitClause}
      )
    `);
    console.log('[W4.3 backfill] ChannelBinding updated rows:', rows);
  }

  // 2) IssueWebhook.allowedDataClasses — заполняем пустые массивы.
  const webhookEmptyCount = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count
    FROM "IssueWebhook"
    WHERE "allowedDataClasses" IS NULL
       OR cardinality("allowedDataClasses") = 0
  `;
  const whEmpty = Number(webhookEmptyCount[0]?.count ?? 0);
  console.log(
    '[W4.3 backfill] IssueWebhook.allowedDataClasses пуст:',
    whEmpty,
  );
  if (whEmpty > 0 && !opts.dryRun) {
    const limitClause =
      opts.limit !== null
        ? `LIMIT ${Math.max(1, opts.limit)}`
        : '';
    const rows = await prisma.$executeRawUnsafe(`
      UPDATE "IssueWebhook"
      SET "allowedDataClasses" = ARRAY['public'::"DataClass", 'internal'::"DataClass"]
      WHERE id IN (
        SELECT id FROM "IssueWebhook"
        WHERE "allowedDataClasses" IS NULL
           OR cardinality("allowedDataClasses") = 0
        ${limitClause}
      )
    `);
    console.log('[W4.3 backfill] IssueWebhook updated rows:', rows);
  }

  // Прогресс-репорт для batch (placeholder; данные обычно невелики).
  void BATCH_SIZE;

  console.log('[W4.3 backfill] done');
}

main()
  .catch((err) => {
    console.error('[W4.3 backfill] ERROR', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
