import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

async function isColumnNullable(table: string, column: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ is_nullable: string }>>`
    SELECT is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
  `;
  return rows[0]?.is_nullable === 'YES';
}

async function backfillStep(): Promise<number> {
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { id: true, ownedOrgs: { select: { id: true } } },
  });

  let updated = 0;
  for (const u of users) {
    const orgId = u.ownedOrgs[0]?.id;
    if (!orgId) continue;
    const res = await prisma.meeting.updateMany({
      where: { ownerId: u.id, tenantId: null },
      data: { tenantId: orgId },
    });
    updated += res.count;
  }
  return updated;
}

async function listOrphans(): Promise<
  Array<{ id: string; title: string; ownerId: string; createdAt: Date }>
> {
  return prisma.meeting.findMany({
    where: { tenantId: null, deletedAt: null },
    select: { id: true, title: true, ownerId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('=== tighten-meeting-tenant-not-null START ===');

  if (!(await isColumnNullable('Meeting', 'tenantId'))) {
    // eslint-disable-next-line no-console
    console.log('OK: Meeting.tenantId уже NOT NULL — миграция не требуется, пропускаем.');
    return;
  }

  const backfilled = await backfillStep();
  // eslint-disable-next-line no-console
  console.log(`Defensive backfill: обновлено ${backfilled} строк.`);

  const orphans = await listOrphans();
  if (orphans.length === 0) {
    // eslint-disable-next-line no-console
    console.log('OK: Meeting.tenantId IS NULL — 0 строк.');
    // eslint-disable-next-line no-console
    console.log('Можно безопасно применять prisma:push с NOT NULL-схемой.');
    return;
  }

  // eslint-disable-next-line no-console
  console.error(`FAIL: остались ${orphans.length} строк Meeting.tenantId IS NULL.`);
  for (const m of orphans) {
    // eslint-disable-next-line no-console
    console.error(
      `  - meeting=${m.id} owner=${m.ownerId} createdAt=${m.createdAt.toISOString()} title="${m.title}"`,
    );
  }
  // eslint-disable-next-line no-console
  console.error(
    'Действие: либо проставить tenantId руками, либо мягко удалить (deletedAt) ' +
      'эти legacy-встречи без владельца в Org. После этого повторить запуск.',
  );
  process.exit(1);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('tighten-meeting-tenant-not-null FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
