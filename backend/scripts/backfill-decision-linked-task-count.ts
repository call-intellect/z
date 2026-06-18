import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

interface RunArgs {
  dryRun: boolean;
}

interface Stats {
  decisionsScanned: number;
  linksCreated: number;
  countersUpdated: number;
}

async function main(args: RunArgs): Promise<void> {
  console.log(`=== backfill-decision-linked-task-count START (dryRun=${args.dryRun}) ===`);
  const stats: Stats = {
    decisionsScanned: 0,
    linksCreated: 0,
    countersUpdated: 0,
  };

  const decisions = await prisma.decision.findMany({
    where: { sourceBlockIds: { isEmpty: false } },
    select: { id: true, tenantId: true, sourceBlockIds: true },
    take: 50_000,
  });

  for (const d of decisions) {
    stats.decisionsScanned++;
    const blockIds = (d.sourceBlockIds ?? []).filter((s) => typeof s === 'string' && s);
    if (blockIds.length === 0) continue;

    const issues = await prisma.issue.findMany({
      where: {
        tenantId: d.tenantId,
        deletedAt: null,
        sourceBlockIds: { hasSome: blockIds },
      },
      select: { id: true },
      take: 2_000,
    });

    if (issues.length > 0 && !args.dryRun) {
      const res = await prisma.decisionTaskLink.createMany({
        data: issues.map((i) => ({
          decisionId: d.id,
          issueId: i.id,
          linkType: 'derived',
        })),
        skipDuplicates: true,
      });
      stats.linksCreated += res.count;
    } else if (issues.length > 0) {
      stats.linksCreated += issues.length;
    }
  }

  if (!args.dryRun) {
    const grouped = await prisma.decisionTaskLink.groupBy({
      by: ['decisionId'],
      _count: { _all: true },
    });
    for (const g of grouped) {
      await prisma.decision.update({
        where: { id: g.decisionId },
        data: { linkedTaskCount: g._count._all },
      });
      stats.countersUpdated++;
    }
    const linkedIds = grouped.map((g) => g.decisionId);
    await prisma.decision.updateMany({
      where: { id: { notIn: linkedIds.length > 0 ? linkedIds : ['__none__'] } },
      data: { linkedTaskCount: 0 },
    });
  }

  console.log(
    `decisionsScanned=${stats.decisionsScanned}, linksCreated=${stats.linksCreated}, countersUpdated=${stats.countersUpdated}`,
  );
  console.log('=== backfill-decision-linked-task-count DONE ===');
}

const dryRun = process.argv.includes('--dry-run');

main({ dryRun })
  .catch((err) => {
    console.error('backfill-decision-linked-task-count FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });
