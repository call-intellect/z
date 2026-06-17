import { createPrismaClient } from './_lib/prisma';

interface Options {
  dryRun: boolean;
  batchSize: number;
  limit?: number;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    dryRun: argv.includes('--dry-run'),
    batchSize: 1000,
  };

  const batchArg = argv.find((a) => a.startsWith('--batch-size='));
  if (batchArg) {
    const v = batchArg.split('=')[1];
    if (v) {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`Invalid --batch-size value: "${v}"`);
      }
      opts.batchSize = Math.floor(n);
    }
  }

  const limitArg = argv.find((a) => a.startsWith('--limit='));
  if (limitArg) {
    const v = limitArg.split('=')[1];
    if (v) {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`Invalid --limit value: "${v}"`);
      }
      opts.limit = Math.floor(n);
    }
  }

  return opts;
}

async function backfillIdeaBlockLink(
  prisma: ReturnType<typeof createPrismaClient>,
  opts: Options,
): Promise<{ scanned: number; updated: number }> {
  const total = await prisma.ideaBlockLink.count({
    where: { validFrom: null },
  });
  // eslint-disable-next-line no-console
  console.log(`\n--- IdeaBlockLink: ${total} записей без validFrom ---`);

  if (total === 0) return { scanned: 0, updated: 0 };
  if (opts.dryRun) {
    // eslint-disable-next-line no-console
    console.log(`[dry-run] Обновили бы ${Math.min(total, opts.limit ?? total)} записей.`);
    return { scanned: total, updated: 0 };
  }

  let updated = 0;
  let scanned = 0;
  const cap = opts.limit ?? Number.POSITIVE_INFINITY;

  let cursorId: string | undefined;
  while (scanned < cap) {
    const take = Math.min(opts.batchSize, cap - scanned);
    const rows: Array<{ id: string; createdAt: Date }> = await prisma.ideaBlockLink.findMany({
      where: { validFrom: null, ...(cursorId ? { id: { gt: cursorId } } : {}) },
      select: { id: true, createdAt: true },
      orderBy: { id: 'asc' },
      take,
    });
    if (rows.length === 0) break;

    const ids = rows.map((r) => r.id);
    const res = await prisma.$executeRawUnsafe(
      `UPDATE "IdeaBlockLink"
          SET "validFrom" = "createdAt"
        WHERE id = ANY($1::text[])
          AND "validFrom" IS NULL`,
      ids,
    );
    updated += Number(res);
    scanned += rows.length;
    cursorId = rows[rows.length - 1]?.id;

    if (scanned % 1000 === 0 || rows.length < take) {
      // eslint-disable-next-line no-console
      console.log(`  IdeaBlockLink: scanned=${scanned} updated=${updated}`);
    }
  }
  return { scanned, updated };
}

async function backfillEntityLink(
  prisma: ReturnType<typeof createPrismaClient>,
  opts: Options,
): Promise<{ scanned: number; updated: number }> {
  const totalRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM "EntityLink" WHERE "validFrom" IS NULL`,
  );
  const total = Number(totalRows[0]?.count ?? 0n);
  // eslint-disable-next-line no-console
  console.log(`\n--- EntityLink: ${total} записей без validFrom ---`);

  if (total === 0) return { scanned: 0, updated: 0 };
  if (opts.dryRun) {
    // eslint-disable-next-line no-console
    console.log(`[dry-run] Обновили бы ${Math.min(total, opts.limit ?? total)} записей.`);
    return { scanned: total, updated: 0 };
  }

  const limitClause = opts.limit
    ? `AND id IN (SELECT id FROM "EntityLink" WHERE "validFrom" IS NULL LIMIT ${opts.limit})`
    : '';
  const res = await prisma.$executeRawUnsafe(
    `UPDATE "EntityLink"
        SET "validFrom" = "createdAt"
      WHERE "validFrom" IS NULL
        ${limitClause}`,
  );
  const updated = Number(res);
  // eslint-disable-next-line no-console
  console.log(`  EntityLink: updated=${updated}`);
  return { scanned: updated, updated };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const prisma = createPrismaClient();

  // eslint-disable-next-line no-console
  console.log(
    `=== backfill-edge-temporal START ` +
      `dryRun=${opts.dryRun} batchSize=${opts.batchSize} ` +
      `limit=${opts.limit ?? '∞'} ===`,
  );

  try {
    const a = await backfillIdeaBlockLink(prisma, opts);
    const b = await backfillEntityLink(prisma, opts);

    // eslint-disable-next-line no-console
    console.log(
      `\n=== SUMMARY === IdeaBlockLink: scanned=${a.scanned} updated=${a.updated} | ` +
        `EntityLink: scanned=${b.scanned} updated=${b.updated}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('backfill-edge-temporal FAILED:', err);
  process.exit(1);
});
