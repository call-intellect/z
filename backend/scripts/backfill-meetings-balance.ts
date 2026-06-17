import { createPrismaClient } from './_lib/prisma';

const DRY_RUN = process.argv.includes('--dry-run');

const STARTING_BALANCE = 150;

const BATCH_SIZE = 500;

interface Counters {
  scanned: number;
  granted: number;
}

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  const counters: Counters = { scanned: 0, granted: 0 };

  // eslint-disable-next-line no-console
  console.log(
    `=== backfill-meetings-balance START (dryRun=${DRY_RUN}, balance=${STARTING_BALANCE}) ===`,
  );

  try {
    while (true) {
      const batch = await prisma.org.findMany({
        where: {
          deletedAt: null,
          meetingsBalance: null,
        },
        select: { id: true },
        take: BATCH_SIZE,
      });

      if (batch.length === 0) break;
      counters.scanned += batch.length;

      if (DRY_RUN) {
        for (const row of batch) {
          // eslint-disable-next-line no-console
          console.log(`  org=${row.id}  → balance=${STARTING_BALANCE}  [dry-run]`);
        }
        break;
      }

      const now = new Date();
      await prisma.$transaction(
        batch.map((row) =>
          prisma.meetingsBalance.create({
            data: {
              tenantId: row.id,
              balance: STARTING_BALANCE,
              totalGranted: STARTING_BALANCE,
              lastGrantedAt: now,
            },
          }),
        ),
      );
      counters.granted += batch.length;

      // eslint-disable-next-line no-console
      console.log(`  granted: ${counters.granted} (текущий batch=${batch.length})`);
    }
  } finally {
    await prisma.$disconnect();
  }

  // eslint-disable-next-line no-console
  console.log(
    `=== backfill-meetings-balance DONE ===\n` +
      `  scanned: ${counters.scanned}\n` +
      `  granted: ${counters.granted}\n` +
      `  dryRun: ${DRY_RUN}`,
  );
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('FATAL', err);
  process.exit(1);
});
