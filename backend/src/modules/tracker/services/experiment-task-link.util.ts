import type { PrismaService } from '../../../common/prisma/prisma.service';

export async function linkDerivedExperimentsForIssue(
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

  const experiments = await prisma.experiment.findMany({
    where: {
      tenantId: args.tenantId,
      sourceBlockIds: { hasSome: blockIds },
    },
    select: { id: true },
    take: 2_000,
  });
  if (experiments.length === 0) return 0;

  const res = await prisma.experimentTaskLink.createMany({
    data: experiments.map((e) => ({
      experimentId: e.id,
      issueId: args.issueId,
      linkType: 'derived',
    })),
    skipDuplicates: true,
  });

  return res.count;
}
