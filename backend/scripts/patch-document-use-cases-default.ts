import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

const DEFAULT_USE_CASE = 'reference';
const BATCH_SIZE = 500;

interface PatchStats {
  scanned: number;
  patched: number;
  alreadySet: number;
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('=== patch-document-use-cases-default START ===');
  const stats: PatchStats = {
    scanned: 0,
    patched: 0,
    alreadySet: 0,
  };

  const total = await prisma.document.count();
  // eslint-disable-next-line no-console
  console.log(`Документов в БД (включая soft-deleted): ${total}`);

  let cursor: string | undefined;
  for (;;) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};
    if (cursor) where.id = { gt: cursor };

    const batch = await prisma.document.findMany({
      where,
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      select: { id: true, useCases: true },
    });
    if (batch.length === 0) break;

    for (const doc of batch) {
      stats.scanned++;
      if (doc.useCases.length > 0) {
        stats.alreadySet++;
        continue;
      }
      await prisma.document.update({
        where: { id: doc.id },
        data: { useCases: [DEFAULT_USE_CASE] },
      });
      stats.patched++;
      // eslint-disable-next-line no-console
      console.log(`[patch] ${doc.id} → [${DEFAULT_USE_CASE}]`);
    }
    cursor = batch[batch.length - 1]?.id;
    if (!cursor) break;
  }

  // eslint-disable-next-line no-console
  console.log(
    `scanned=${stats.scanned}, patched=${stats.patched}, already_set=${stats.alreadySet}`,
  );
  // eslint-disable-next-line no-console
  console.log('=== patch-document-use-cases-default DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('patch-document-use-cases-default FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
