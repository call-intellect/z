import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

async function main() {
  console.log('[backfill-onboarding] Начало...');

  const orgsWithDepts = await prisma.department.groupBy({
    by: ['tenantId'],
    _count: { _all: true },
  });

  const orgIds = orgsWithDepts.filter((g) => g._count._all > 0).map((g) => g.tenantId);

  if (orgIds.length === 0) {
    console.log('[backfill-onboarding] Нет Org с отделами — нечего бэкфилить.');
    return;
  }

  console.log(`[backfill-onboarding] Найдено ${orgIds.length} Org с отделами.`);

  let updated = 0;
  const BATCH = 100;
  for (let i = 0; i < orgIds.length; i += BATCH) {
    const batch = orgIds.slice(i, i + BATCH);
    const orgs = await prisma.org.findMany({
      where: { id: { in: batch }, setupCompletedAt: null },
      select: { id: true, createdAt: true },
    });
    for (const org of orgs) {
      await prisma.org.update({
        where: { id: org.id },
        data: { setupCompletedAt: org.createdAt },
      });
    }
    updated += orgs.length;
    console.log(`[backfill-onboarding] Обновлено: ${updated}`);
  }

  console.log(`[backfill-onboarding] Готово. Всего обновлено: ${updated} Org.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
