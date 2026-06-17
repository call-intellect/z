import { Prisma, PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';
import { tableExists } from './_lib/schema-guards';

import { resolveAppointmentStatus } from '../src/modules/appointments/services/tenant-top';

const APPLY = process.argv.includes('--apply');
const prisma = createPrismaClient();

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
    `=== patch-migrate-person-role-to-appointment START (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===`,
  );

  if (!(await tableExists(prisma, 'PersonRole'))) {
    console.log(
      'Таблица PersonRole удалена — миграция в Appointment завершена ранее, обновление не требуется.',
    );
    await prisma.$disconnect();
    return;
  }

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
    const ratio = (counters.alreadyMigrated + counters.migrated) / counters.totalPersonRoles;
    console.log(
      `  progress (already + migrated) / total = ${ratio.toFixed(3)} (1.000 = 100% мигрировано)`,
    );
  }

  if (!APPLY) {
    console.log('  DRY-RUN: ничего не записано. Перезапустите с --apply для применения.');
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
