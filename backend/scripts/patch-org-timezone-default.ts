/**
 * SBA β-8.1 — Patch: проставить `Org.timezone = 'Europe/Moscow'` для всех
 * Org с timezone IS NULL.
 *
 * Зачем: новая колонка `Org.timezone` (sub-ТЗ §5) имеет
 * `@default("Europe/Moscow")`, но default применяется только к новым INSERT'ам.
 * Существующие Org'и в проде остаются с NULL, что ломает
 * `OperationsWeeklyDigestCron` (он фильтрует Org по локальному часу/дню).
 *
 * Запуск:
 *   bun run scripts/patch-org-timezone-default.ts
 *   bun run scripts/patch-org-timezone-default.ts --dry-run
 *
 * Идемпотентность: повторный запуск — no-op (где timezone уже не NULL).
 *
 * Safe-seed-rules: НЕ перезаписываем существующие timezone — только NULL → дефолт.
 */

import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

const DEFAULT_TIMEZONE = 'Europe/Moscow';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  // eslint-disable-next-line no-console
  console.log(
    `=== patch-org-timezone-default START (dryRun=${dryRun}) ===`,
  );

  const toUpdateCount = await prisma.org.count({
    where: { timezone: null },
  });
  // eslint-disable-next-line no-console
  console.log(`[count] Org с timezone IS NULL: ${toUpdateCount}`);

  if (toUpdateCount === 0) {
    // eslint-disable-next-line no-console
    console.log('[skip] Нет записей под обновление — выходим');
    return;
  }

  if (dryRun) {
    // eslint-disable-next-line no-console
    console.log(
      `[dry-run] Было бы обновлено ${toUpdateCount} Org с timezone='${DEFAULT_TIMEZONE}'`,
    );
    return;
  }

  const result = await prisma.org.updateMany({
    where: { timezone: null },
    data: { timezone: DEFAULT_TIMEZONE },
  });
  // eslint-disable-next-line no-console
  console.log(
    `[update] Обновлено Org: ${result.count} (timezone → '${DEFAULT_TIMEZONE}')`,
  );

  // eslint-disable-next-line no-console
  console.log('=== patch-org-timezone-default DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('patch-org-timezone-default FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });
