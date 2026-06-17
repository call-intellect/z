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

  const bindingNullCount = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count
    FROM channel_bindings
    WHERE "maxDataClass" IS NULL
  `;
  const cbNulls = Number(bindingNullCount[0]?.count ?? 0);
  console.log('[W4.3 backfill] ChannelBinding.maxDataClass IS NULL:', cbNulls);
  if (cbNulls > 0 && !opts.dryRun) {
    const limitClause = opts.limit !== null ? `LIMIT ${Math.max(1, opts.limit)}` : '';
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

  const webhookEmptyCount = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count
    FROM "IssueWebhook"
    WHERE "allowedDataClasses" IS NULL
       OR cardinality("allowedDataClasses") = 0
  `;
  const whEmpty = Number(webhookEmptyCount[0]?.count ?? 0);
  console.log('[W4.3 backfill] IssueWebhook.allowedDataClasses пуст:', whEmpty);
  if (whEmpty > 0 && !opts.dryRun) {
    const limitClause = opts.limit !== null ? `LIMIT ${Math.max(1, opts.limit)}` : '';
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
