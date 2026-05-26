/**
 * Wave 3 / Tracker Phase 4 — Seed системных TeamTemplate (10 + 5 опц).
 *
 * Запуск:
 *   cd backend && bun run scripts/seed-team-templates.ts
 *
 * Идемпотентно по `@@unique([tenantId, slug])` (tenantId=null для системных).
 * Защита admin-edited: если `updatedAt > createdAt + 1ч` — skip с warn.
 *
 * См. `src/modules/tracker/seed/team-templates-data.ts` — данные шаблонов.
 */

import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

import { seedSystemTeamTemplates } from '../src/modules/tracker/seed/team-templates-seed';

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  try {
    // eslint-disable-next-line no-console
    console.log('=== seed-team-templates START ===');
    const stats = await seedSystemTeamTemplates(prisma);
    // eslint-disable-next-line no-console
    console.log(
      `inserted=${stats.inserted}, updated=${stats.updated}, skippedAdminEdited=${stats.skippedAdminEdited}`,
    );
    // eslint-disable-next-line no-console
    console.log('=== seed-team-templates DONE ===');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('seed-team-templates FAILED:', err);
  process.exit(1);
});
