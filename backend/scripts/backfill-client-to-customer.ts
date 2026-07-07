import { createPrismaClient } from './_lib/prisma';

interface BackfillArgs {
  dryRun: boolean;
  org?: string;
}

interface BackfillResult {
  scanned: number;
  updated: number;
}

function parseArgs(argv: string[]): BackfillArgs {
  const dryRun = argv.includes('--dry-run');
  const orgArg = argv.find((a) => a.startsWith('--org='));
  const org = orgArg ? orgArg.slice('--org='.length) : undefined;
  return { dryRun, org };
}

export async function backfillClientToCustomer(
  prisma: ReturnType<typeof createPrismaClient>,
  args: BackfillArgs,
): Promise<BackfillResult> {
  const where = {
    type: 'client' as const,
    mergedIntoId: null,
    ...(args.org ? { tenantId: args.org } : {}),
  };

  const scanned = await prisma.entity.count({ where });

  if (args.dryRun) {
    return { scanned, updated: 0 };
  }

  const res = await prisma.entity.updateMany({
    where,
    data: { type: 'customer' },
  });

  return { scanned, updated: res.count };
}

async function main(args: BackfillArgs): Promise<void> {
  const prisma = createPrismaClient();
  try {
    console.log(
      `=== backfill-client-to-customer START (dryRun=${args.dryRun}, org=${args.org ?? 'ALL'}) ===`,
    );
    const result = await backfillClientToCustomer(prisma, args);
    console.log(`scanned=${result.scanned}, updated=${result.updated}`);
    if (args.dryRun) {
      console.log('DRY-RUN: в БД ничего не записано. Запусти без --dry-run, чтобы применить.');
    }
    console.log('=== backfill-client-to-customer DONE ===');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main(parseArgs(process.argv)).catch((err) => {
    console.error('backfill-client-to-customer FAILED:', err);
    process.exit(1);
  });
}
