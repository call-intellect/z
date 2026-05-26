/**
 * Wave 2 — Seed 5 базовых Badge.
 *
 * Запуск:
 *   cd backend && bun run scripts/seed-badges.ts
 *
 * Идемпотентность (skill `safe-seed-rules`): по `slug` (unique). Если запись
 * существует — не перезаписываем (админ мог поменять name/description/condition).
 */

import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

import { seedBaseBadges } from '../src/modules/recognition/seed/badge-seed';

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  try {
    // eslint-disable-next-line no-console
    console.log('=== seed-badges START ===');
    const stats = await seedBaseBadges(prisma);
    // eslint-disable-next-line no-console
    console.log(`inserted=${stats.inserted}, skipped=${stats.skipped}`);
    // eslint-disable-next-line no-console
    console.log('=== seed-badges DONE ===');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('seed-badges FAILED:', err);
  process.exit(1);
});
