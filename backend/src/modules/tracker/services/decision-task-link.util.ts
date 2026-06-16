import type { PrismaService } from '../../../common/prisma/prisma.service';

export async function linkDerivedDecisionsForIssue(
  prisma: PrismaService,
  args: {
    tenantId: string;
    issueId: string;
    sourceBlockIds: string[];
  },
): Promise<number> {
  const blockIds = (args.sourceBlockIds ?? []).filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  );
  if (blockIds.length === 0) return 0;

  const decisions = await prisma.decision.findMany({
    where: {
      tenantId: args.tenantId,
      sourceBlockIds: { hasSome: blockIds },
    },
    select: { id: true },
    take: 2_000,
  });
  if (decisions.length === 0) return 0;

  const res = await prisma.decisionTaskLink.createMany({
    data: decisions.map((d) => ({
      decisionId: d.id,
      issueId: args.issueId,
      linkType: 'derived',
    })),
    skipDuplicates: true,
  });

  if (res.count > 0) {
    const grouped = await prisma.decisionTaskLink.groupBy({
      by: ['decisionId'],
      where: { decisionId: { in: decisions.map((d) => d.id) } },
      _count: { _all: true },
    });
    for (const g of grouped) {
      await prisma.decision.update({
        where: { id: g.decisionId },
        data: { linkedTaskCount: g._count._all },
      });
    }
  }

  return res.count;
}
