/**
 * SBA β-8 — Patch: проставить `Person.timezone = 'Europe/Moscow'` для всех
 * Person с timezone IS NULL.
 *
 * Зачем: новая колонка `Person.timezone` (sub-ТЗ §5) имеет `@default("Europe/Moscow")`,
 * но default применяется только к новым INSERT'ам. Существующие Person'ы в
 * проде остаются с NULL, что ломает `DailyCheckInPromptCron` (он фильтрует
 * employees по локальному часу).
 *
 * Запуск:
 *   bun run scripts/patch-person-timezone-default.ts
 *   bun run scripts/patch-person-timezone-default.ts --dry-run
 *
 * Идемпотентность: повторный запуск — no-op (где timezone уже не NULL).
 *
 * Safe-seed-rules: НЕ перезаписываем существующие timezone — только NULL → дефолт.
 */

import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';
import { isColumnNullable } from './_lib/schema-guards';

const prisma = createPrismaClient();

const DEFAULT_TIMEZONE = 'Europe/Moscow';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  // eslint-disable-next-line no-console
  console.log(
    `=== patch-person-timezone-default START (dryRun=${dryRun}) ===`,
  );

  // Guard: если Person.timezone уже NOT NULL (cleanup-миграция применена) —
  // типизированный where:{timezone:null} упал бы Prisma 7-валидацией.
  if (!(await isColumnNullable(prisma, 'Person', 'timezone'))) {
    // eslint-disable-next-line no-console
    console.log(
      'Person.timezone уже NOT NULL — дефолт проставлен ранее, обновление не требуется.',
    );
    return;
  }

  const toUpdateCount = await prisma.person.count({
    where: { timezone: null },
  });
  // eslint-disable-next-line no-console
  console.log(
    `[count] Persons с timezone IS NULL: ${toUpdateCount}`,
  );

  if (toUpdateCount === 0) {
    // eslint-disable-next-line no-console
    console.log('[skip] Нет записей под обновление — выходим');
    return;
  }

  if (dryRun) {
    // eslint-disable-next-line no-console
    console.log(
      `[dry-run] Было бы обновлено ${toUpdateCount} Person с timezone='${DEFAULT_TIMEZONE}'`,
    );
    return;
  }

  const result = await prisma.person.updateMany({
    where: { timezone: null },
    data: { timezone: DEFAULT_TIMEZONE },
  });
  // eslint-disable-next-line no-console
  console.log(
    `[update] Обновлено Person: ${result.count} (timezone → '${DEFAULT_TIMEZONE}')`,
  );

  // eslint-disable-next-line no-console
  console.log('=== patch-person-timezone-default DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('patch-person-timezone-default FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
