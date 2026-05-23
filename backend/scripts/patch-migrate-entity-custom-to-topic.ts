/**
 * Patch (SBA α-3 wave 2) — миграция Entity.type='custom' → 'topic'.
 *
 * Postgres не поддерживает DROP VALUE для enum'а, поэтому в schema.prisma
 * `custom` остаётся deprecated рядом с актуальными типами. Этот скрипт
 * переписывает существующие Entity с type='custom' на 'topic', сохраняя id
 * (никаких каскадных изменений в IdeaBlockEntity / EntityLink / Card.entityId).
 *
 * Запуск:
 *   bun run scripts/patch-migrate-entity-custom-to-topic.ts          — реальное обновление
 *   bun run scripts/patch-migrate-entity-custom-to-topic.ts --dry-run — только подсчёт
 *
 * Идемпотентно: повторный запуск увидит `count=0`.
 *
 * После применения в проде:
 *   1. SELECT COUNT(*) FROM "Entity" WHERE type='custom' → 0.
 *   2. В одной из следующих фаз — удалить значение `custom` из enum'а через
 *      full rebuild enum (опасная операция, в этот скрипт НЕ входит).
 *
 * Зачем `topic`, а не отдельный fallback: `topic` — это general-purpose контейнер
 * для тем/концепций, которые не подпадают под другие типизированные A-категории.
 * Это поведенчески ближе всего к семантике старого `custom`. См. delta §α-3.
 */

import { PrismaClient } from '@prisma/client';

const DRY_RUN = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    /* eslint-disable no-console */
    console.log(
      `=== patch-migrate-entity-custom-to-topic START (${DRY_RUN ? 'DRY-RUN' : 'REAL'}) ===`,
    );

    const beforeRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM "Entity" WHERE type = 'custom'::"EntityType"
    `;
    const before = Number(beforeRows[0]?.count ?? 0n);
    console.log(`Найдено Entity с type='custom': ${before}`);

    if (before === 0) {
      console.log('Нечего мигрировать — пропуск.');
      return;
    }

    if (DRY_RUN) {
      console.log('DRY-RUN: изменения НЕ записаны.');
      return;
    }

    const result = await prisma.$executeRawUnsafe(
      `UPDATE "Entity" SET type = 'topic'::"EntityType" WHERE type = 'custom'::"EntityType"`,
    );
    console.log(`Обновлено строк: ${result}`);

    const afterRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM "Entity" WHERE type = 'custom'::"EntityType"
    `;
    const after = Number(afterRows[0]?.count ?? 0n);
    console.log(`Осталось с type='custom': ${after}`);
    if (after !== 0) {
      console.warn(
        '!!! После UPDATE остались строки type=custom — нужно расследовать.',
      );
    }
    console.log('=== patch-migrate-entity-custom-to-topic DONE ===');
    /* eslint-enable no-console */
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('patch-migrate-entity-custom-to-topic FAILED:', err);
  process.exit(1);
});
