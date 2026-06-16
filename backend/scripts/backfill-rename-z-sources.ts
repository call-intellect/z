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
