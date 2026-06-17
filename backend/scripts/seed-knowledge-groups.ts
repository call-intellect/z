import type { Prisma, PrismaClient } from '@prisma/client';

import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

interface Stats {
  orgsScanned: number;
  closedCreated: number;
  closedSkipped: number;
  deptCreated: number;
  deptSkipped: number;
  membersCreated: number;
  membersSkipped: number;
}

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

const DRY_RUN = process.argv.includes('--dry-run');

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'P2002'
  );
}

async function ensureGroup(args: {
  tenantId: string;
  kind: 'department' | 'leadership' | 'council' | 'personal';
  refId: string | null;
  name: string;
  isClosed: boolean;
}): Promise<{ id: string | null; created: boolean }> {
  const existing = await prisma.knowledgeGroup.findFirst({
    where: { tenantId: args.tenantId, kind: args.kind, refId: args.refId },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };
  if (DRY_RUN) return { id: null, created: true };
  try {
    const created = await prisma.knowledgeGroup.create({
      data: {
        tenantId: args.tenantId,
        kind: args.kind,
        refId: args.refId,
        name: args.name,
        isClosed: args.isClosed,
      },
      select: { id: true },
    });
    return { id: created.id, created: true };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const row = await prisma.knowledgeGroup.findFirst({
        where: { tenantId: args.tenantId, kind: args.kind, refId: args.refId },
        select: { id: true },
      });
      return { id: row?.id ?? null, created: false };
    }
    throw err;
  }
}

async function ensureMember(args: {
  groupId: string;
  personId: string;
  source: 'auto' | 'manual';
}): Promise<boolean> {
  const existing = await prisma.knowledgeGroupMember.findUnique({
    where: { groupId_personId: { groupId: args.groupId, personId: args.personId } },
    select: { groupId: true },
  });
  if (existing) return false;
  if (DRY_RUN) return true;
  try {
    await prisma.knowledgeGroupMember.create({
      data: { groupId: args.groupId, personId: args.personId, source: args.source },
    });
    return true;
  } catch (err) {
    if (isUniqueViolation(err)) return false;
    throw err;
  }
}

async function seedForTenant(tenantId: string, stats: Stats): Promise<void> {
  const leadership = await ensureGroup({
    tenantId,
    kind: 'leadership',
    refId: null,
    name: 'Руководство',
    isClosed: true,
  });
  leadership.created ? stats.closedCreated++ : stats.closedSkipped++;

  const council = await ensureGroup({
    tenantId,
    kind: 'council',
    refId: null,
    name: 'Совет',
    isClosed: true,
  });
  council.created ? stats.closedCreated++ : stats.closedSkipped++;

  const departments = await prisma.department.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, name: true },
  });
  for (const d of departments) {
    const g = await ensureGroup({
      tenantId,
      kind: 'department',
      refId: d.id,
      name: d.name,
      isClosed: false,
    });
    g.created ? stats.deptCreated++ : stats.deptSkipped++;
  }

  if (!leadership.id) {
    return;
  }
  const leadershipPersonIds = new Set<string>();
  const adminMemberships = await prisma.membership.findMany({
    where: {
      orgId: tenantId,
      role: { in: ['owner', 'admin'] as Prisma.MembershipRole[] },
      personId: { not: null },
    },
    select: { personId: true },
  });
  for (const m of adminMemberships) if (m.personId) leadershipPersonIds.add(m.personId);
  const headed = await prisma.department.findMany({
    where: { tenantId, deletedAt: null, headPersonId: { not: null } },
    select: { headPersonId: true },
  });
  for (const h of headed) if (h.headPersonId) leadershipPersonIds.add(h.headPersonId);

  for (const personId of leadershipPersonIds) {
    const added = await ensureMember({
      groupId: leadership.id,
      personId,
      source: 'auto',
    });
    added ? stats.membersCreated++ : stats.membersSkipped++;
  }
}

async function main(): Promise<void> {
  const tenantArg = getArg('tenant');

  const stats: Stats = {
    orgsScanned: 0,
    closedCreated: 0,
    closedSkipped: 0,
    deptCreated: 0,
    deptSkipped: 0,
    membersCreated: 0,
    membersSkipped: 0,
  };

  /* eslint-disable no-console */
  console.log(
    `=== seed-knowledge-groups START (tenant=${tenantArg ?? 'ALL'}${DRY_RUN ? ', DRY-RUN' : ''}) ===`,
  );

  const tenantIds: string[] = [];
  if (tenantArg) {
    const org = await prisma.org.findUnique({
      where: { id: tenantArg },
      select: { id: true, deletedAt: true },
    });
    if (!org) {
      console.error(`Org ${tenantArg} не найдена`);
      process.exit(1);
    }
    tenantIds.push(org.id);
  } else {
    const orgs = await prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    for (const o of orgs) tenantIds.push(o.id);
  }

  for (const tId of tenantIds) {
    stats.orgsScanned++;
    await seedForTenant(tId, stats);
  }

  console.log('=== Итоги seed-knowledge-groups ===');
  console.log(`  orgsScanned    : ${stats.orgsScanned}`);
  console.log(`  closedCreated  : ${stats.closedCreated} / skipped ${stats.closedSkipped}`);
  console.log(`  deptCreated    : ${stats.deptCreated} / skipped ${stats.deptSkipped}`);
  console.log(`  membersCreated : ${stats.membersCreated} / skipped ${stats.membersSkipped}`);
  console.log(
    `=== seed-knowledge-groups DONE${DRY_RUN ? ' (DRY-RUN — ничего не записано)' : ''} ===`,
  );
  /* eslint-enable no-console */
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error('seed-knowledge-groups FAILED:', err);
    await (prisma as PrismaClient).$disconnect();
    process.exit(1);
  });
