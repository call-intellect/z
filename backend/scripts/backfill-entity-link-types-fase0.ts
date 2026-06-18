import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

async function main(): Promise<void> {
  const prisma = createPrismaClient();

  const before = await prisma.entityLink.count({
    where: { OR: [{ fromType: null }, { toType: null }] },
  });
  // eslint-disable-next-line no-console
  console.log(`=== backfill-entity-link-types START — ${before} legacy записей ===`);

  if (before === 0) {
    // eslint-disable-next-line no-console
    console.log('✓ Нет записей для backfill (уже всё проставлено).');
    await prisma.$disconnect();
    return;
  }

  const updated = await prisma.$executeRawUnsafe(`
    UPDATE "EntityLink"
       SET "fromType" = COALESCE("fromType", 'entity'),
           "toType"   = COALESCE("toType",   'entity')
     WHERE "fromType" IS NULL OR "toType" IS NULL;
  `);

  const after = await prisma.entityLink.count({
    where: { OR: [{ fromType: null }, { toType: null }] },
  });

  // eslint-disable-next-line no-console
  console.log(`✓ backfill: обновлено ${updated}, осталось null: ${after}`);
  // eslint-disable-next-line no-console
  console.log('=== backfill-entity-link-types DONE ===');

  await prisma.$disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('backfill-entity-link-types FAILED:', err);
  process.exit(1);
});
