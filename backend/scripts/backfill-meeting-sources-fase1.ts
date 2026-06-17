import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

const SOURCE_NAME = 'Встречи Z';

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('=== backfill-meeting-sources-fase1 START ===');

  const orgs = await prisma.org.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  });
  // eslint-disable-next-line no-console
  console.log(`Активных Org: ${orgs.length}`);

  let created = 0;
  let skipped = 0;
  for (const org of orgs) {
    const existing = await prisma.source.findUnique({
      where: {
        tenantId_type_name: {
          tenantId: org.id,
          type: 'meeting',
          name: SOURCE_NAME,
        },
      },
    });
    if (existing) {
      skipped++;
      continue;
    }
    await prisma.source.create({
      data: {
        tenantId: org.id,
        type: 'meeting',
        name: SOURCE_NAME,
        dataClass: 'internal',
        isActive: true,
      },
    });
    created++;
    // eslint-disable-next-line no-console
    console.log(`  + Source создан для Org "${org.name}" (${org.id})`);
  }

  // eslint-disable-next-line no-console
  console.log(`Source создано: ${created}, пропущено (уже было): ${skipped}`);
  // eslint-disable-next-line no-console
  console.log('=== backfill-meeting-sources-fase1 DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('backfill-meeting-sources-fase1 FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
