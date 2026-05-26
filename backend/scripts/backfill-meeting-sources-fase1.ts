/**
 * Backfill для Фазы 1 knowledge-core ТЗ.
 *
 * Задача: для каждой существующей `Org`, у которой ещё нет дефолтного
 * `Source(type=meeting, name='Встречи Z')`, создать его. Это нужно
 * для уже-существующих Org из Фазы 0; новые Org с Фазы 1 получают
 * дефолтный Source автоматически в `OrgsService.createForOwner`.
 *
 * Запуск:
 *   tsx scripts/backfill-meeting-sources-fase1.ts
 *
 * Идемпотентен: повторный запуск ничего не ломает (пропускает уже-созданные).
 *
 * См. правила safe-seed-rules: используем createMany с skipDuplicates,
 * не делаем mass updateMany без явного where.
 */

import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

const SOURCE_NAME = 'Встречи Z';

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('=== backfill-meeting-sources-fase1 START ===');

  const orgs = await prisma.org.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  });
  // eslint-disable-next-line no-console
  console.log(`Активных Org: ${orgs.length}`);

  let created = 0;
  let skipped = 0;
  for (const org of orgs) {
    const existing = await prisma.source.findUnique({
      where: {
        tenantId_type_name: {
          tenantId: org.id,
          type: 'meeting',
          name: SOURCE_NAME,
        },
      },
    });
    if (existing) {
      skipped++;
      continue;
    }
    await prisma.source.create({
      data: {
        tenantId: org.id,
        type: 'meeting',
        name: SOURCE_NAME,
        dataClass: 'internal',
        isActive: true,
      },
    });
    created++;
    // eslint-disable-next-line no-console
    console.log(`  + Source создан для Org "${org.name}" (${org.id})`);
  }

  // eslint-disable-next-line no-console
  console.log(`Source создано: ${created}, пропущено (уже было): ${skipped}`);
  // eslint-disable-next-line no-console
  console.log('=== backfill-meeting-sources-fase1 DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('backfill-meeting-sources-fase1 FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
