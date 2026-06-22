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
      deletedAt: null,
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

export async function linkDerivedTasksForDecision(
  prisma: PrismaService,
  args: {
    tenantId: string;
    decisionId: string;
    sourceBlockIds: string[];
  },
): Promise<number> {
  const blockIds = (args.sourceBlockIds ?? []).filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  );
  if (blockIds.length === 0) return 0;

  const issues = await prisma.issue.findMany({
    where: {
      tenantId: args.tenantId,
      deletedAt: null,
      sourceBlockIds: { hasSome: blockIds },
    },
    select: { id: true },
    take: 2_000,
  });
  if (issues.length === 0) return 0;

  const res = await prisma.decisionTaskLink.createMany({
    data: issues.map((i) => ({
      decisionId: args.decisionId,
      issueId: i.id,
      linkType: 'derived',
    })),
    skipDuplicates: true,
  });

  if (res.count > 0) {
    const total = await prisma.decisionTaskLink.count({
      where: { decisionId: args.decisionId },
    });
    await prisma.decision.update({
      where: { id: args.decisionId },
      data: { linkedTaskCount: total },
    });
  }

  return res.count;
}

export async function maybeMarkDecisionsImplementedForIssue(
  prisma: PrismaService,
  args: {
    tenantId: string;
    issueId: string;
  },
): Promise<void> {
  try {
    const links = await prisma.decisionTaskLink.findMany({
      where: { issueId: args.issueId },
      select: { decisionId: true },
      take: 2_000,
    });
    const decisionIds = [...new Set(links.map((l) => l.decisionId))];
    if (decisionIds.length === 0) return;

    for (const decisionId of decisionIds) {
      const decisionLinks = await prisma.decisionTaskLink.findMany({
        where: { decisionId },
        select: { issueId: true },
        take: 2_000,
      });
      const issueIds = [...new Set(decisionLinks.map((l) => l.issueId))];
      if (issueIds.length === 0) continue;

      const openCount = await prisma.issue.count({
        where: {
          id: { in: issueIds },
          tenantId: args.tenantId,
          deletedAt: null,
          state: { is: { category: { notIn: ['completed', 'cancelled'] } } },
        },
      });
      if (openCount > 0) continue;

      await prisma.decision.updateMany({
        where: {
          id: decisionId,
          tenantId: args.tenantId,
          status: { in: ['approved', 'active', 'proposed'] },
        },
        data: { status: 'implemented' },
      });
    }
  } catch {
    return;
  }
}
