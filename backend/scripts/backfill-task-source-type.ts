import { createPrismaClient } from './_lib/prisma';

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  try {
    const res = await prisma.task.updateMany({
      where: { sourceType: '' },
      data: { sourceType: 'meeting' },
    });
    // eslint-disable-next-line no-console
    console.log(`backfill-task-source-type: updated=${res.count} (sourceType='' → 'meeting')`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('backfill-task-source-type FAILED:', err);
  process.exit(1);
});
