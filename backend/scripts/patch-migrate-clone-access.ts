import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

type GrantInput = {
  tenantId: string;
  grantedToUserId: string;
  cloneType: 'role';
  cloneRefId: string;
  grantedById: string;
};

interface OrgStat {
  tenantId: string;
  orgName: string;
  prepared: number;
  created: number;
  skippedDuplicates: number;
  skippedTenant: boolean;
  skipReason?: string;
}

function parseArgs(): { tenantId: string | null } {
  const args = process.argv.slice(2);
  let tenantId: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--tenant' && args[i + 1]) {
      tenantId = args[i + 1] ?? null;
      i++;
    }
  }
  return { tenantId };
}

function keyOf(g: { grantedToUserId: string; cloneType: string; cloneRefId: string }): string {
  return `${g.grantedToUserId}::${g.cloneType}::${g.cloneRefId}`;
}

async function findActorUserId(tenantId: string): Promise<string | null> {
  const owner = await prisma.membership.findFirst({
    where: { orgId: tenantId, role: 'owner' },
    orderBy: { joinedAt: 'asc' },
    select: { userId: true },
  });
  if (owner) return owner.userId;

  const admin = await prisma.membership.findFirst({
    where: { orgId: tenantId, role: 'admin' },
    orderBy: { joinedAt: 'asc' },
    select: { userId: true },
  });
  return admin?.userId ?? null;
}

async function migrateOrg(tenantId: string, orgName: string): Promise<OrgStat> {
  const base: OrgStat = {
    tenantId,
    orgName,
    prepared: 0,
    created: 0,
    skippedDuplicates: 0,
    skippedTenant: false,
  };

  const actorUserId = await findActorUserId(tenantId);
  if (!actorUserId) {
    return {
      ...base,
      skippedTenant: true,
      skipReason: 'no owner/admin in tenant',
    };
  }

  const grants = new Map<string, GrantInput>();
  const addGrant = (grant: Omit<GrantInput, 'tenantId' | 'grantedById'>) => {
    const full: GrantInput = {
      tenantId,
      grantedById: actorUserId,
      ...grant,
    };
    grants.set(keyOf(full), full);
  };

  const activeAppointments = await prisma.appointment.findMany({
    where: {
      tenantId,
      validTo: null,
      status: { in: ['active', 'acting'] },
    },
    select: {
      roleId: true,
      person: {
        select: {
          userId: true,
          primaryDepartmentId: true,
        },
      },
    },
  });

  for (const ap of activeAppointments) {
    if (!ap.person.userId) continue;
    addGrant({
      grantedToUserId: ap.person.userId,
      cloneType: 'role',
      cloneRefId: ap.roleId,
    });
  }

  const departmentToRoleIds = new Map<string, Set<string>>();
  for (const ap of activeAppointments) {
    const dep = ap.person.primaryDepartmentId;
    if (!dep) continue;
    let bucket = departmentToRoleIds.get(dep);
    if (!bucket) {
      bucket = new Set();
      departmentToRoleIds.set(dep, bucket);
    }
    bucket.add(ap.roleId);
  }

  for (const [depId, roleIds] of departmentToRoleIds) {
    const managers = await prisma.membership.findMany({
      where: {
        orgId: tenantId,
        role: 'manager',
        person: {
          tenantId,
          primaryDepartmentId: depId,
          deletedAt: null,
        },
      },
      select: { userId: true },
    });
    for (const m of managers) {
      for (const roleId of roleIds) {
        addGrant({
          grantedToUserId: m.userId,
          cloneType: 'role',
          cloneRefId: roleId,
        });
      }
    }
  }

  const orgAdmins = await prisma.membership.findMany({
    where: {
      orgId: tenantId,
      role: { in: ['owner', 'admin'] },
    },
    select: { userId: true },
  });

  const allRoles = await prisma.role.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true },
  });

  for (const a of orgAdmins) {
    for (const r of allRoles) {
      addGrant({
        grantedToUserId: a.userId,
        cloneType: 'role',
        cloneRefId: r.id,
      });
    }
  }

  base.prepared = grants.size;
  if (grants.size === 0) {
    return base;
  }

  const data = Array.from(grants.values());
  const res = await prisma.cloneAccessGrant.createMany({
    data,
    skipDuplicates: true,
  });
  base.created = res.count;
  base.skippedDuplicates = data.length - res.count;
  return base;
}

async function main(): Promise<void> {
  const { tenantId } = parseArgs();
  /* eslint-disable no-console */
  console.log(`=== patch-migrate-clone-access START (tenantId=${tenantId ?? 'ALL'}) ===`);

  const orgs = tenantId
    ? await prisma.org.findMany({
        where: { id: tenantId },
        select: { id: true, name: true },
      })
    : await prisma.org.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true },
        orderBy: { id: 'asc' },
      });

  if (orgs.length === 0) {
    console.warn(
      `[migrate-clone-access] нет тенантов для обработки${
        tenantId ? ` (фильтр --tenant=${tenantId} не нашёл Org)` : ''
      }`,
    );
  }

  let totalCreated = 0;
  let totalSkippedDup = 0;
  let totalPrepared = 0;
  let tenantsSkipped = 0;

  for (const org of orgs) {
    const stat = await migrateOrg(org.id, org.name);
    if (stat.skippedTenant) {
      tenantsSkipped++;
      console.warn(
        `[migrate-clone-access] tenant=${stat.tenantId} (${stat.orgName}): пропущен — ${stat.skipReason}`,
      );
      continue;
    }
    console.log(
      `[migrate-clone-access] tenant=${stat.tenantId} (${stat.orgName}): подготовлено ${stat.prepared}, создано ${stat.created}, пропущено дубликатов ${stat.skippedDuplicates}`,
    );
    totalPrepared += stat.prepared;
    totalCreated += stat.created;
    totalSkippedDup += stat.skippedDuplicates;
  }

  console.log('=== patch-migrate-clone-access DONE ===');
  console.log(`  тенантов обработано:        ${orgs.length - tenantsSkipped}`);
  console.log(`  тенантов пропущено:         ${tenantsSkipped}`);
  console.log(`  грантов подготовлено всего: ${totalPrepared}`);
  console.log(`  грантов создано:            ${totalCreated}`);
  console.log(`  дубликатов пропущено:       ${totalSkippedDup}`);
  /* eslint-enable no-console */
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('patch-migrate-clone-access FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
