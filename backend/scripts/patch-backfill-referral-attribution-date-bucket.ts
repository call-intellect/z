import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

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

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  console.log('[audit Б8 backfill-referral-attribution-date-bucket] start', {
    dryRun: opts.dryRun,
  });

  const toFill = await prisma.$queryRaw<Array<{ cnt: bigint }>>`
    SELECT COUNT(*)::bigint AS cnt
    FROM "ReferralAttribution"
    WHERE "dateBucket" IS NULL OR "dateBucket" = ''
  `;
  const fillCount = Number(toFill[0]?.cnt ?? 0n);

  console.log(`[audit Б8] записей без dateBucket: ${fillCount}`);

  if (fillCount > 0 && !opts.dryRun) {
    const updated: number = await prisma.$executeRaw`
      UPDATE "ReferralAttribution"
      SET "dateBucket" = to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD')
      WHERE "dateBucket" IS NULL OR "dateBucket" = ''
    `;

    console.log(`[audit Б8] backfilled dateBucket: ${updated} строк`);
  }

  const dupGroups = await prisma.$queryRaw<
    Array<{
      referral_id: string;
      fingerprint: string;
      date_bucket: string;
      cnt: bigint;
    }>
  >`
    SELECT
      "referralId" AS referral_id,
      "fingerprint",
      "dateBucket" AS date_bucket,
      COUNT(*)::bigint AS cnt
    FROM "ReferralAttribution"
    WHERE "fingerprint" IS NOT NULL
    GROUP BY "referralId", "fingerprint", "dateBucket"
    HAVING COUNT(*) > 1
  `;

  console.log(`[audit Б8] дубль-групп (referralId, fingerprint, dateBucket): ${dupGroups.length}`);

  let totalDeleted = 0;
  for (const g of dupGroups) {
    const dupes = await prisma.referralAttribution.findMany({
      where: {
        referralId: g.referral_id,
        fingerprint: g.fingerprint,
        dateBucket: g.date_bucket,
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (dupes.length <= 1) continue;
    const toDelete = dupes.slice(1).map((d) => d.id);
    if (!opts.dryRun) {
      const res = await prisma.referralAttribution.deleteMany({
        where: { id: { in: toDelete } },
      });
      totalDeleted += res.count;
    } else {
      totalDeleted += toDelete.length;
    }
  }

  console.log(`[audit Б8] deleted dup-rows (оставлена самая старая в группе): ${totalDeleted}`);

  console.log('[audit Б8 backfill-referral-attribution-date-bucket] done');
}

main()
  .catch((err) => {
    console.error('[audit Б8] FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
