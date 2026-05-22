/**
 * Patch (SBA α-3) — переименование Entity.type='client' → 'customer'.
 *
 * Postgres не поддерживает `DROP/RENAME VALUE` для enum'а напрямую, поэтому
 * в schema.prisma мы оставили оба значения (`client` deprecated + `customer`).
 * Этот скрипт переписывает существующие Entity, сохраняя id (никаких каскадных
 * изменений в IdeaBlockEntity / EntityLink / Card.entityId — все references
 * по id остаются валидны).
 *
 * Запуск:
 *   bun run scripts/patch-rename-client-to-customer.ts          — реальное обновление
 *   bun run scripts/patch-rename-client-to-customer.ts --dry-run — только подсчёт
 *
 * Идемпотентно: повторный запуск увидит `count=0` (все client уже converted).
 *
 * После применения в проде:
 *   1. Убедиться, что в БД 0 строк с type='client': `SELECT COUNT(*) FROM "Entity" WHERE type='client';`.
 *   2. В будущей фазе удалить значение `client` из enum'а (через миграцию
 *      с full rebuild enum). На α-3 НЕ удаляем — оставляем deprecated.
 */

import { PrismaClient } from '@prisma/client';

const DRY_RUN = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    /* eslint-disable no-console */
    console.log(
      `=== patch-rename-client-to-customer START (${DRY_RUN ? 'DRY-RUN' : 'REAL'}) ===`,
    );

    // Подсчитаем кандидатов до изменения.
    const beforeRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM "Entity" WHERE type = 'client'::"EntityType"
    `;
    const before = Number(beforeRows[0]?.count ?? 0n);
    console.log(`Найдено Entity с type='client': ${before}`);

    if (before === 0) {
      console.log('Нечего конвертировать — пропуск.');
      return;
    }

    if (DRY_RUN) {
      console.log('DRY-RUN: изменения НЕ записаны.');
      return;
    }

    // Выполняем raw UPDATE: Prisma client сам не умеет менять enum-значение
    // на новое в одной транзакции — proще $executeRawUnsafe.
    const result = await prisma.$executeRawUnsafe(
      `UPDATE "Entity" SET type = 'customer'::"EntityType" WHERE type = 'client'::"EntityType"`,
    );

    console.log(`Обновлено строк: ${result}`);

    const afterRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM "Entity" WHERE type = 'client'::"EntityType"
    `;
    const after = Number(afterRows[0]?.count ?? 0n);
    console.log(`Осталось с type='client': ${after}`);
    if (after !== 0) {
      console.warn(
        '!!! После UPDATE остались строки type=client — нужно расследовать.',
      );
    }
    console.log('=== patch-rename-client-to-customer DONE ===');
    /* eslint-enable no-console */
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('patch-rename-client-to-customer FAILED:', err);
  process.exit(1);
});
