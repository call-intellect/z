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
  console.log('[audit Б7 dedupe-billing-event-log] start', { dryRun: opts.dryRun });

  const groups = await prisma.$queryRaw<
    Array<{
      provider_name: string | null;
      external_event_id: string;
      cnt: bigint;
    }>
  >`
    SELECT "providerName" AS provider_name, "externalEventId" AS external_event_id, COUNT(*)::bigint AS cnt
    FROM "BillingEventLog"
    WHERE "externalEventId" IS NOT NULL
    GROUP BY "providerName", "externalEventId"
    HAVING COUNT(*) > 1
  `;

  console.log(`[audit Б7 dedupe-billing-event-log] дубль-групп найдено: ${groups.length}`);

  let totalToDelete = 0;
  for (const g of groups) {
    const dupes = await prisma.billingEventLog.findMany({
      where: {
        providerName: g.provider_name as never,
        externalEventId: g.external_event_id,
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, createdAt: true },
    });
    if (dupes.length <= 1) continue;
    const [keep, ...trash] = dupes;
    totalToDelete += trash.length;
    if (opts.dryRun) {
      console.log(
        `[audit Б7 dedupe-billing-event-log] would delete ${trash.length} (keep=${keep!.id}) provider=${g.provider_name ?? '-'} eventId=${g.external_event_id}`,
      );
      continue;
    }
    await prisma.billingEventLog.deleteMany({
      where: { id: { in: trash.map((t) => t.id) } },
    });
    console.log(
      `[audit Б7 dedupe-billing-event-log] deleted ${trash.length} (keep=${keep!.id}) provider=${g.provider_name ?? '-'} eventId=${g.external_event_id}`,
    );
  }

  console.log(
    `[audit Б7 dedupe-billing-event-log] done. К удалению: ${totalToDelete}` +
      (opts.dryRun ? ' (dry-run)' : ''),
  );
}

main()
  .catch((err) => {
    console.error('[audit Б7 dedupe-billing-event-log] ERROR', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
