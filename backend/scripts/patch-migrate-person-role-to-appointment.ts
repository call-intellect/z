/**
 * SBA α-8 wave 3 — patch-migrate PersonRole → Appointment.
 *
 * Логика (см. plans/tz/2026-05-23-sba-alpha-8-wave3-appointment-kpi.md §6):
 *   1. SELECT все PersonRole WHERE NOT EXISTS Appointment с тем же
 *      (personId, roleId, validFrom) — идемпотентность.
 *   2. Для каждого:
 *      a. Резолв departmentId:
 *         - сначала Person.primaryDepartmentId (snapshot текущий, ок для migration);
 *         - иначе EntityLink (person → department, relationType=member_of, active) на дату validFrom;
 *         - иначе NULL (admin доделает руками).
 *      b. status: 'former' если validTo<now(), 'active' иначе.
 *      c. loadPercent: 100 (нет данных в PersonRole).
 *      d. confidence: 1.0 (manual-equivalent).
 *   3. INSERT Appointment.
 *   4. Log сводку: N migrated, M skipped (already in Appointment), K failed.
 *
 * Запуск:
 *   bun run scripts/patch-migrate-person-role-to-appointment.ts            (dry-run)
 *   bun run scripts/patch-migrate-person-role-to-appointment.ts --apply    (реальная миграция)
 *
 * Идемпотентно: повторный запуск ничего не делает, если данные уже мигрированы.
 * НЕ удаляет PersonRole (отдельный sub-ТЗ через 1 месяц после прод-миграции).
 *
 * @see plans/tz/2026-05-23-sba-alpha-8-wave3-appointment-kpi.md
 */

import { Prisma, PrismaClient } from '@prisma/client';

import { resolveAppointmentStatus } from '../src/modules/appointments/services/tenant-top';

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

interface Counters {
  totalPersonRoles: number;
  alreadyMigrated: number;
  migrated: number;
  failed: number;
  departmentResolvedFromPrimary: number;
  departmentResolvedFromLink: number;
  departmentMissing: number;
}

async function main(): Promise<void> {
  const counters: Counters = {
    totalPersonRoles: 0,
    alreadyMigrated: 0,
    migrated: 0,
    failed: 0,
    departmentResolvedFromPrimary: 0,
    departmentResolvedFromLink: 0,
    departmentMissing: 0,
  };

  /* eslint-disable no-console */
  console.log(
    `=== patch-migrate-person-role-to-appointment START (${
      APPLY ? 'APPLY' : 'DRY-RUN'
    }) ===`,
  );

  const personRoles = await prisma.personRole.findMany({
    select: {
      id: true,
      tenantId: true,
      personId: true,
      roleId: true,
      validFrom: true,
      validTo: true,
    },
    orderBy: [{ tenantId: 'asc' }, { validFrom: 'asc' }],
  });
  counters.totalPersonRoles = personRoles.length;
  console.log(`  PersonRole scanned: ${personRoles.length}`);

  for (const pr of personRoles) {
    try {
      const existing = await prisma.appointment.findFirst({
        where: {
          tenantId: pr.tenantId,
          personId: pr.personId,
          roleId: pr.roleId,
          validFrom: pr.validFrom,
        },
        select: { id: true },
      });
      if (existing) {
        counters.alreadyMigrated++;
        continue;
      }

      // Резолв departmentId.
      let departmentId: string | null = null;
      const person = await prisma.person.findUnique({
        where: { id: pr.personId },
        select: { primaryDepartmentId: true },
      });
      if (person?.primaryDepartmentId) {
        departmentId = person.primaryDepartmentId;
        counters.departmentResolvedFromPrimary++;
      } else {
        const link = await prisma.entityLink.findFirst({
          where: {
            tenantId: pr.tenantId,
            fromEntityId: pr.personId,
            fromType: 'person',
            toType: 'department',
            relationType: 'member_of',
            status: 'active',
            deletedAt: null,
          },
          select: { toEntityId: true },
          orderBy: { validFrom: 'desc' },
        });
        if (link?.toEntityId) {
          departmentId = link.toEntityId;
          counters.departmentResolvedFromLink++;
        } else {
          counters.departmentMissing++;
        }
      }

      const status = resolveAppointmentStatus(pr.validTo);

      if (APPLY) {
        await prisma.appointment.create({
          data: {
            tenantId: pr.tenantId,
            personId: pr.personId,
            roleId: pr.roleId,
            departmentId,
            loadPercent: 100,
            status,
            validFrom: pr.validFrom,
            validTo: pr.validTo,
            sourceBlockIds: [],
            confidence: new Prisma.Decimal('1.000'),
          },
        });
      }
      counters.migrated++;
    } catch (err) {
      counters.failed++;
      console.error(
        `  ✖ failed to migrate PersonRole ${pr.id} (person=${pr.personId}, role=${pr.roleId}):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log('=== summary ===');
  console.log(JSON.stringify(counters, null, 2));

  if (counters.totalPersonRoles > 0) {
    const ratio = (counters.alreadyMigrated + counters.migrated) /
      counters.totalPersonRoles;
    console.log(
      `  progress (already + migrated) / total = ${ratio.toFixed(3)} (1.000 = 100% мигрировано)`,
    );
  }

  if (!APPLY) {
    console.log(
      '  DRY-RUN: ничего не записано. Перезапустите с --apply для применения.',
    );
  }
  /* eslint-enable no-console */

  await prisma.$disconnect();
}

main().catch(async (e) => {
  /* eslint-disable no-console */
  console.error('FATAL', e);
  /* eslint-enable no-console */
  await prisma.$disconnect();
  process.exit(1);
});
