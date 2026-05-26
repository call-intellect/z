/**
 * Первичная миграция грантов клонов при включении `CLONE_V2_ENABLED=true`.
 *
 * Под флагом V2 единственный источник правды о доступе к клону —
 * `CloneAccessGrant` (см. RbacService.canAccessRoleClone/canAccessPersonClone
 * + ТЗ `plans/tz/2026-05-26-clone-access-grant-admin-api.md`). Без записи
 * в этой таблице доступа нет ни у кого — даже у owner Org. Поэтому перед
 * флипом флага нужно подложить первичные гранты, иначе все пользователи
 * теряют доступ к клонам одномоментно.
 *
 * Правила выдачи (ТЗ §7.2):
 *  1. Носитель роли (Appointment validTo IS NULL, status IN ('active','acting'))
 *     с заполненным Person.userId → грант на свой role-клон.
 *  2. Manager того же отдела (Membership.role='manager', и Person этого
 *     manager-membership имеет primaryDepartmentId == primaryDepartmentId
 *     носителя) → грант на role-клон подчинённого. Это та же логика,
 *     что и `RbacService.canAccessPersonCloneLegacy` (rbac.service.ts ~593).
 *  3. Owner / admin Org (Membership.role IN ('owner','admin')) → гранты
 *     на все активные role-клоны Org (Role.deletedAt IS NULL).
 *
 * Person-клоны (cloneType='person') скрипт НЕ выдаёт — клоны в Z теперь
 * ролевые, не персональные (memory `project_clones_are_role_based`,
 * рефлексия 2026-05-25). Person-grant остаётся как ручная админская опция
 * через `POST /api/v1/admin/clones/access-grants` с cloneType='person'.
 *
 * `grantedById` для первичных грантов = User.id первого (по joinedAt)
 * owner'а Org. Если owner'ов нет — первый admin. Если и admin'ов нет —
 * тенант пропускается с warn'ом (некому формально «выдать» грант).
 *
 * `expiresAt`/`revokedAt` — null (бессрочные, не отозванные).
 *
 * ИДЕМПОТЕНТНОСТЬ. Уникальный индекс
 *   (tenantId, grantedToUserId, cloneType, cloneRefId)
 * + `createMany({ skipDuplicates: true })` (Postgres `ON CONFLICT DO NOTHING`).
 * Повторный запуск:
 *   - активные гранты, которые уже есть, → пропускаются как дубликаты;
 *   - revoked-гранты, которые admin отозвал руками, скрипт НЕ воскрешает
 *     (revoked-запись физически осталась, дубликат → пропуск). Это
 *     намеренное решение (§7.4): патч не должен перебивать решения админа.
 *
 * Запуск:
 *   bun run scripts/patch-migrate-clone-access.ts                  # все тенанты
 *   bun run scripts/patch-migrate-clone-access.ts --tenant <orgId> # один тенант
 *
 * Перед прогоном на проде убедитесь, что схема актуальна:
 *   bun run prisma:push
 *
 * ТЗ: plans/tz/2026-05-26-clone-access-grant-admin-api.md §7
 */

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

function keyOf(g: {
  grantedToUserId: string;
  cloneType: string;
  cloneRefId: string;
}): string {
  return `${g.grantedToUserId}::${g.cloneType}::${g.cloneRefId}`;
}

async function findActorUserId(tenantId: string): Promise<string | null> {
  // 1) Owner с самым ранним joinedAt — детерминированный выбор.
  const owner = await prisma.membership.findFirst({
    where: { orgId: tenantId, role: 'owner' },
    orderBy: { joinedAt: 'asc' },
    select: { userId: true },
  });
  if (owner) return owner.userId;

  // 2) Fallback на admin'а.
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

  // Уникальные (grantedToUserId, cloneType, cloneRefId) внутри Org.
  // Map нужен, чтобы внутри одного прогона не плодить дубли (например, owner —
  // он же manager того же отдела, он же носитель).
  const grants = new Map<string, GrantInput>();
  const addGrant = (grant: Omit<GrantInput, 'tenantId' | 'grantedById'>) => {
    const full: GrantInput = {
      tenantId,
      grantedById: actorUserId,
      ...grant,
    };
    grants.set(keyOf(full), full);
  };

  // Правило 1: носители активных ролей → грант на свой role-клон.
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
    if (!ap.person.userId) continue; // Person без linked User — не выдаём.
    addGrant({
      grantedToUserId: ap.person.userId,
      cloneType: 'role',
      cloneRefId: ap.roleId,
    });
  }

  // Правило 2: manager того же primaryDepartmentId → грант на каждый role-клон
  // отдела. Группируем roleId носителей по primaryDepartmentId, чтобы один
  // findMany на отдел давал список manager'ов, а затем матрица manager×roles.
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
    // Manager того же отдела — это Membership(role='manager') у которого
    // привязанный Person имеет primaryDepartmentId === depId. Это совпадает
    // с логикой RbacService.canAccessPersonCloneLegacy (~rbac.service.ts:593):
    // там «manager» = есть Membership(role='manager') + Person требующего
    // имеет тот же primaryDepartmentId, что и target.
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

  // Правило 3: owner/admin Org → все активные role-клоны (все Role,
  // не soft-deleted). Берём все Role: даже если ExecutablePersona ещё
  // не построена, грант пусть лежит готовым (UI просто не покажет клона
  // без persona; зато при первом же билде клон сразу доступен).
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

  // createMany + skipDuplicates: идемпотентность через unique-индекс
  // (tenantId, grantedToUserId, cloneType, cloneRefId).
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
  console.log(
    `=== patch-migrate-clone-access START (tenantId=${tenantId ?? 'ALL'}) ===`,
  );

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
