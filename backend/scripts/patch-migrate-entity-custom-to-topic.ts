import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';
import { enumHasValue } from './_lib/schema-guards';

const DRY_RUN = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  try {
    /* eslint-disable no-console */
    console.log(
      `=== patch-migrate-entity-custom-to-topic START (${DRY_RUN ? 'DRY-RUN' : 'REAL'}) ===`,
    );

    if (!(await enumHasValue(prisma, 'EntityType', 'custom'))) {
      console.log(
        "enum-значение 'custom' уже удалено из EntityType — миграция применена ранее, обновление не требуется.",
      );
      return;
    }

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
      console.warn('!!! После UPDATE остались строки type=custom — нужно расследовать.');
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
