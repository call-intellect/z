import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

import { seedHolidayCalendarRu2026 } from '../src/modules/tracker/seed/holiday-calendar-seed';

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  try {
    // eslint-disable-next-line no-console
    console.log('=== seed-holiday-calendar-ru-2026 START ===');
    const stats = await seedHolidayCalendarRu2026(prisma);
    // eslint-disable-next-line no-console
    console.log(
      `inserted=${stats.inserted}, updated=${stats.updated}, skippedAdminEdited=${stats.skippedAdminEdited}`,
    );
    // eslint-disable-next-line no-console
    console.log('=== seed-holiday-calendar-ru-2026 DONE ===');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('seed-holiday-calendar-ru-2026 FAILED:', err);
  process.exit(1);
});
