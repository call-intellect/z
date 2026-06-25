import type { Prisma, PrismaClient } from '@prisma/client';

import { createPrismaClient } from './_lib/prisma';

const KEYS = [
  'feature.tables_text_to_schema',
  'knowledge.curationAutotuneEnabled',
] as const;

export interface ExistingSetting {
  value: Prisma.JsonValue;
  updatedBy: string | null;
}

export type Decision = 'update' | 'skip-absent' | 'skip-already-true' | 'skip-admin-edited';

export function decide(existing: ExistingSetting | null): Decision {
  if (existing === null) return 'skip-absent';
  if (existing.value === true) return 'skip-already-true';
  if (existing.updatedBy !== null) return 'skip-admin-edited';
  if (existing.value === false) return 'update';
  return 'skip-already-true';
}

export interface Stats {
  updated: number;
  skippedAbsent: number;
  skippedAlreadyTrue: number;
  skippedAdminEdited: number;
}

export async function patchEnableShippedFlags(prisma: PrismaClient): Promise<Stats> {
  const stats: Stats = {
    updated: 0,
    skippedAbsent: 0,
    skippedAlreadyTrue: 0,
    skippedAdminEdited: 0,
  };

  console.log('=== patch-enable-shipped-flags START ===');

  for (const key of KEYS) {
    const existing = await prisma.adminSetting.findUnique({
      where: { key },
      select: { value: true, updatedBy: true },
    });

    const decision = decide(existing);

    switch (decision) {
      case 'update': {
        await prisma.adminSetting.update({
          where: { key },
          data: { value: true },
        });
        stats.updated++;
        console.log(`  [update] ${key}: false → true`);
        break;
      }
      case 'skip-absent': {
        stats.skippedAbsent++;
        console.log(`  [skip] ${key}: absent (code-fallback покроет)`);
        break;
      }
      case 'skip-already-true': {
        stats.skippedAlreadyTrue++;
        console.log(`  [skip] ${key}: already-true`);
        break;
      }
      case 'skip-admin-edited': {
        stats.skippedAdminEdited++;
        console.log(`  [skip] ${key}: admin-edited (updatedBy != null), уважаем override`);
        break;
      }
    }
  }

  console.log('=== Итоги patch-enable-shipped-flags ===');
  console.log(`  updated            : ${stats.updated}`);
  console.log(`  skipped (absent)   : ${stats.skippedAbsent}`);
  console.log(`  skipped (already)  : ${stats.skippedAlreadyTrue}`);
  console.log(`  skipped (admin-ed) : ${stats.skippedAdminEdited}`);

  return stats;
}

if (require.main === module) {
  const prisma = createPrismaClient();
  patchEnableShippedFlags(prisma)
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('patch-enable-shipped-flags FAILED:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
