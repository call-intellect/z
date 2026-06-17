import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

async function renameSource(
  from: string,
  to: string,
): Promise<{ renamed: number; skipped: number }> {
  const sources = await prisma.source.findMany({
    where: { name: from },
    select: { id: true, tenantId: true, type: true },
  });
  let renamed = 0;
  let skipped = 0;
  for (const s of sources) {
    const conflict = await prisma.source.findFirst({
      where: { tenantId: s.tenantId, type: s.type, name: to },
      select: { id: true },
    });
    if (conflict) {
      skipped += 1;
      continue;
    }
    await prisma.source.update({ where: { id: s.id }, data: { name: to } });
    renamed += 1;
  }
  return { renamed, skipped };
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('=== backfill-rename-z-sources START ===');

  const meetings = await renameSource('Встречи Z', 'Встречи');
  // eslint-disable-next-line no-console
  console.log(
    `'Встречи Z' → 'Встречи': renamed=${meetings.renamed}, skipped(conflict)=${meetings.skipped}`,
  );

  const tracker = await renameSource('Трекер Z', 'Трекер');
  // eslint-disable-next-line no-console
  console.log(
    `'Трекер Z' → 'Трекер': renamed=${tracker.renamed}, skipped(conflict)=${tracker.skipped}`,
  );

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
