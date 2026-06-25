import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';
import { isSpineTwin } from './migrate-task-to-issue';

interface CliFlags {
  apply: boolean;
  orgId: string | null;
}

interface Stats {
  legacyTotal: number;
  collapsed: number;
  retagged: number;
  taskSourceMoved: number;
}

function parseFlags(argv: string[]): CliFlags {
  const apply = argv.includes('--apply');
  const orgIdx = argv.indexOf('--org-id');
  const orgId = orgIdx !== -1 && orgIdx + 1 < argv.length ? (argv[orgIdx + 1] ?? null) : null;
  return { apply, orgId };
}

async function findCanon(
  prisma: PrismaClient,
  tenantId: string,
  legacy: { id: string; title: string; sourceBlockIds: string[]; linkedMeetingIds: string[] },
): Promise<{ id: string } | null> {
  if (legacy.linkedMeetingIds.length === 0) return null;

  const canons = await prisma.issue.findMany({
    where: {
      tenantId,
      externalSource: 'meeting',
      deletedAt: null,
      linkedMeetingIds: { hasSome: legacy.linkedMeetingIds },
      id: { not: legacy.id },
    },
    select: { id: true, title: true, sourceBlockIds: true },
  });

  for (const c of canons) {
    if (
      isSpineTwin(
        { title: legacy.title, evidenceBlockIds: legacy.sourceBlockIds },
        { title: c.title, sourceBlockIds: c.sourceBlockIds },
      )
    ) {
      return { id: c.id };
    }
  }
  return null;
}

async function moveProvenance(
  prisma: PrismaClient,
  legacyIssueId: string,
  canonIssueId: string,
): Promise<number> {
  const sources = await prisma.taskSource.findMany({
    where: { issueId: legacyIssueId },
    select: { id: true, tenantId: true, sourceType: true, sourceRefId: true, chatId: true, quote: true },
  });

  let moved = 0;
  for (const s of sources) {
    try {
      await prisma.taskSource.update({
        where: { id: s.id },
        data: { issueId: canonIssueId },
      });
      moved += 1;
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') {
        await prisma.taskSource.delete({ where: { id: s.id } });
      } else {
        throw e;
      }
    }
  }
  return moved;
}

async function processOrg(
  prisma: PrismaClient,
  org: { id: string; name: string },
  apply: boolean,
): Promise<Stats> {
  const stats: Stats = { legacyTotal: 0, collapsed: 0, retagged: 0, taskSourceMoved: 0 };

  const legacyIssues = await prisma.issue.findMany({
    where: {
      tenantId: org.id,
      externalSource: 'meeting_legacy',
      deletedAt: null,
    },
    select: { id: true, title: true, sourceBlockIds: true, linkedMeetingIds: true },
  });
  stats.legacyTotal = legacyIssues.length;

  for (const legacy of legacyIssues) {
    const canon = await findCanon(prisma, org.id, legacy);

    if (canon) {
      if (apply) {
        const moved = await moveProvenance(prisma, legacy.id, canon.id);
        stats.taskSourceMoved += moved;
        await prisma.issue.delete({ where: { id: legacy.id } });
      } else {
        const sources = await prisma.taskSource.count({ where: { issueId: legacy.id } });
        stats.taskSourceMoved += sources;
      }
      stats.collapsed += 1;
      console.log(
        `  [${org.id}] legacy=${legacy.id} → collapse into canon=${canon.id}${apply ? '' : ' (dry-run)'}`,
      );
    } else {
      if (apply) {
        await prisma.issue.update({
          where: { id: legacy.id },
          data: { externalSource: 'meeting' },
        });
      }
      stats.retagged += 1;
      console.log(
        `  [${org.id}] legacy=${legacy.id} → retag meeting_legacy→meeting${apply ? '' : ' (dry-run)'}`,
      );
    }
  }

  return stats;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const mode = flags.apply ? 'APPLY' : 'DRY-RUN';
  console.log(`=== backfill-collapse-legacy-task-duplicates START (${mode}) ===`);
  if (flags.orgId) console.log(`Scope: org=${flags.orgId}`);
  else console.log('Scope: ВСЕ организации');

  const prisma = createPrismaClient();
  const all: Stats[] = [];

  try {
    const orgs = await prisma.org.findMany({
      where: {
        deletedAt: null,
        ...(flags.orgId ? { id: flags.orgId } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    });

    if (orgs.length === 0) {
      console.warn('Не найдено организаций (с учётом фильтров).');
      return;
    }

    for (const org of orgs) {
      console.log(`\n→ Org "${org.name}" (${org.id})`);
      const stats = await processOrg(prisma, org, flags.apply);
      all.push(stats);
      console.log(
        `  legacy=${stats.legacyTotal}  collapsed=${stats.collapsed}  retagged=${stats.retagged}  taskSourceMoved=${stats.taskSourceMoved}`,
      );
    }

    const sum = all.reduce(
      (acc, s) => ({
        legacyTotal: acc.legacyTotal + s.legacyTotal,
        collapsed: acc.collapsed + s.collapsed,
        retagged: acc.retagged + s.retagged,
        taskSourceMoved: acc.taskSourceMoved + s.taskSourceMoved,
      }),
      { legacyTotal: 0, collapsed: 0, retagged: 0, taskSourceMoved: 0 },
    );

    console.log('\n=== SUMMARY ===');
    console.log(`Mode:             ${mode}`);
    console.log(`Legacy всего:     ${sum.legacyTotal}`);
    console.log(`Collapsed:        ${sum.collapsed}`);
    console.log(`Retagged:         ${sum.retagged}`);
    console.log(`TaskSource moved: ${sum.taskSourceMoved}`);
    if (!flags.apply) {
      console.log('\nDRY-RUN: в БД ничего не записано. Запусти с --apply, чтобы применить.');
    }
    console.log('=== backfill-collapse-legacy-task-duplicates DONE ===');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('backfill-collapse-legacy-task-duplicates FAILED:', err);
    process.exit(1);
  });
}
