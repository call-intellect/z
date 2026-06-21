import { createPrismaClient } from './_lib/prisma';

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  try {
    const res = await prisma.project.updateMany({
      where: { gantViewEnabled: false },
      data: { gantViewEnabled: true },
    });
    console.log(
      `[backfill-gant-view] gantViewEnabled=true для ${res.count} проектов (Ф4 Ship-On)`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('backfill-gant-view FAILED:', err);
  process.exit(1);
});
