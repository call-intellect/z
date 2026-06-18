import { createPrismaClient } from './_lib/prisma';

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
  const prisma = createPrismaClient();
  // eslint-disable-next-line no-console
  console.log('[patch-daily-checkin-backfill-source] start', {
    dryRun: opts.dryRun,
  });

  try {
    const candidatesCount = await prisma.dailyCheckIn.count({
      where: { notificationId: null, source: 'cron_prompted' },
    });
    // eslint-disable-next-line no-console
    console.log(`[patch-daily-checkin-backfill-source] candidates: ${candidatesCount}`);

    if (opts.dryRun) {
      // eslint-disable-next-line no-console
      console.log('[patch-daily-checkin-backfill-source] dry-run — skipping update');
      return;
    }

    const result = await prisma.dailyCheckIn.updateMany({
      where: { notificationId: null, source: 'cron_prompted' },
      data: { source: 'manual' },
    });
    // eslint-disable-next-line no-console
    console.log(`[patch-daily-checkin-backfill-source] updated: ${result.count}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[patch-daily-checkin-backfill-source] ERROR', err);
  process.exit(1);
});
