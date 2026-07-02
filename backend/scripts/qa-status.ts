import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

async function main(): Promise<void> {
  const org = process.env['STRELA_ORG'];
  if (!org) throw new Error('STRELA_ORG не задан');

  const raw = (await prisma.$queryRawUnsafe(
    'select "processingStatus" as s, count(*)::int as c from "RawEvent" where "tenantId"=$1 group by "processingStatus" order by 2 desc',
    org,
  )) as Array<{ s: string; c: number }>;

  const [ideaBlock, entity, decision, insight, idea, goal, intakeIssue, theme, person, dailyCheckIn, meeting] = await Promise.all([
    prisma.ideaBlock.count({ where: { tenantId: org } }),
    prisma.entity.count({ where: { tenantId: org } }),
    prisma.decision.count({ where: { tenantId: org } }),
    prisma.insight.count({ where: { tenantId: org } }),
    prisma.idea.count({ where: { tenantId: org } }),
    prisma.goal.count({ where: { tenantId: org } }),
    prisma.intakeIssue.count({ where: { tenantId: org } }),
    prisma.theme.count({ where: { tenantId: org } }),
    prisma.person.count({ where: { tenantId: org } }),
    prisma.dailyCheckIn.count({ where: { tenantId: org } }),
    prisma.meeting.count({ where: { tenantId: org } }),
  ]);

  // eslint-disable-next-line no-console
  console.log('RawEvent:', raw.map((r) => `${r.s}=${r.c}`).join(' '));
  // eslint-disable-next-line no-console
  console.log(
    `blocks=${ideaBlock} entity=${entity} decision=${decision} insight=${insight} idea=${idea} goal=${goal} intake=${intakeIssue} theme=${theme} person=${person} checkin=${dailyCheckIn} meeting=${meeting}`,
  );

  const goals = await prisma.goal.findMany({
    where: { tenantId: org },
    select: { id: true, name: true, parentGoalId: true, isPrimary: true, horizon: true, source: true, externalSource: true },
    orderBy: { createdAt: 'asc' },
  });
  const roots = goals.filter((g) => !g.parentGoalId);
  // eslint-disable-next-line no-console
  console.log(`\nЦели (${goals.length}), деревьев-корней: ${roots.length}`);
  const printTree = (parentId: string | null, depth: number): void => {
    for (const g of goals.filter((x) => x.parentGoalId === parentId)) {
      // eslint-disable-next-line no-console
      console.log(`${'  '.repeat(depth)}${g.isPrimary ? '★ ' : '• '}${g.name} [${g.horizon}${g.externalSource ? ',' + g.externalSource : ''}]`);
      printTree(g.id, depth + 1);
    }
  };
  printTree(null, 0);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error('qa-status FAILED:', e);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });
