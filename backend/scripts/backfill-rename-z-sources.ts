/**
 * Backfill: переименование устаревших Source-записей «Встречи Z» → «Встречи»
 * и «Трекер Z» → «Трекер» в БД (брендинг Z → Кора).
 *
 * Запуск:
 *   bun run scripts/backfill-rename-z-sources.ts
 *
 * Идемпотентен: повторный запуск безопасен — старых имён уже не будет,
 * updateMany с where вернёт count=0.
 *
 * Новые Org получают правильные имена автоматически (MeetingIngestAdapter
 * и TrackerAdapter обновлены в рамках этого же изменения).
 */

import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('=== backfill-rename-z-sources START ===');

  const meetingsResult = await prisma.source.updateMany({
    where: { name: 'Встречи Z' },
    data: { name: 'Встречи' },
  });
  // eslint-disable-next-line no-console
  console.log(`'Встречи Z' → 'Встречи': обновлено ${meetingsResult.count} записей`);

  const trackerResult = await prisma.source.updateMany({
    where: { name: 'Трекер Z' },
    data: { name: 'Трекер' },
  });
  // eslint-disable-next-line no-console
  console.log(`'Трекер Z' → 'Трекер': обновлено ${trackerResult.count} записей`);

  // eslint-disable-next-line no-console
  console.log('=== backfill-rename-z-sources DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('backfill-rename-z-sources FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
