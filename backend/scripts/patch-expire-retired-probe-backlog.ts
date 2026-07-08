import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

const RETIRED_REASON_PREFIXES = [
  'consistency_violation.',
  'attribution.',
  'experiment.',
  'insight.',
  'process_template.',
  'knowledge.new_expertise',
  'helpfulness.new_expertise',
];

const PENDING_STATUSES = ['queued_digest', 'routed_to_digest', 'pending'] as const;

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  // eslint-disable-next-line no-console
  console.log(`=== patch-expire-retired-probe-backlog START (dryRun=${dryRun}) ===`);

  const where = {
    status: { in: [...PENDING_STATUSES] },
    OR: RETIRED_REASON_PREFIXES.map((prefix) => ({ reason: { startsWith: prefix } })),
  };

  const grouped = await prisma.probeEvent.groupBy({
    by: ['reason'],
    where,
    _count: { _all: true },
    orderBy: { _count: { reason: 'desc' } },
  });

  const total = grouped.reduce((acc, g) => acc + g._count._all, 0);
  // eslint-disable-next-line no-console
  console.log(`[count] отставленных probe в очереди: ${total} (reasons=${grouped.length})`);
  for (const g of grouped) {
    // eslint-disable-next-line no-console
    console.log(`  ${g.reason}: ${g._count._all}`);
  }

  if (total === 0) {
    // eslint-disable-next-line no-console
    console.log('[skip] очередь отставленных поводов пуста — выходим');
    return;
  }

  if (dryRun) {
    // eslint-disable-next-line no-console
    console.log(`[dry-run] было бы переведено в expired: ${total}`);
    return;
  }

  const result = await prisma.probeEvent.updateMany({
    where,
    data: { status: 'expired' },
  });
  // eslint-disable-next-line no-console
  console.log(`[update] переведено в expired: ${result.count}`);
  // eslint-disable-next-line no-console
  console.log('=== patch-expire-retired-probe-backlog DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('patch-expire-retired-probe-backlog FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });
