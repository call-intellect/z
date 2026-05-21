/**
 * Backfill `EntityLink.fromType` / `toType` для legacy-записей (до Фазы 0).
 *
 * С Фазы 0a модель EntityLink стала полиморфной: одни связи остаются
 * Entity↔Entity (knowledge-core, до Фазы 0), другие — между бизнес-сущностями
 * Фазы 0 (Role/Person/Process/...). Discriminator — поля `fromType` / `toType`.
 *
 * Существующие записи EntityLink, созданные до миграции, имеют
 * `fromType IS NULL` / `toType IS NULL`. Этот скрипт безопасно проставляет
 * им `'entity'` — единственно правильное значение, так как до Фазы 0
 * EntityLink хранил только Entity↔Entity связи (FK constraint).
 *
 * Запуск (из backend/):
 *   bun run scripts/backfill-entity-link-types-fase0.ts
 *
 * Идемпотентность: апдейтит только записи WHERE fromType IS NULL OR toType IS NULL.
 * Повторный запуск — no-op.
 */

import { PrismaClient } from '@prisma/client';

async function main(): Promise<void> {
  const prisma = new PrismaClient();

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

  // Один UPDATE через raw SQL — Prisma updateMany не позволит OR + AND с двумя SET.
  // Гарантия: и fromType, и toType заполнятся в одной транзакции.
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
