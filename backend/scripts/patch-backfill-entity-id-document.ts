/**
 * Patch (SBA α-3) — backfill Document.entityId.
 *
 * Для каждого Document без entityId — найти или создать
 * Entity{type='document', canonicalName=Document.name, tenantId}.
 *
 * Запуск:
 *   bun run scripts/patch-backfill-entity-id-document.ts          — реальный backfill
 *   bun run scripts/patch-backfill-entity-id-document.ts --dry-run — только подсчёт
 *
 * Идемпотентно (`entityId IS NULL`). Батч 1000.
 */

import { PrismaClient } from '@prisma/client';

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 1000;

interface Counters {
  scanned: number;
  linkedExisting: number;
  createdNew: number;
  skippedEmpty: number;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const counters: Counters = {
    scanned: 0,
    linkedExisting: 0,
    createdNew: 0,
    skippedEmpty: 0,
  };

  try {
    /* eslint-disable no-console */
    console.log(
      `=== patch-backfill-entity-id-document START (${DRY_RUN ? 'DRY-RUN' : 'REAL'}) ===`,
    );

    let cursorId: string | undefined = undefined;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const batch = await prisma.document.findMany({
        where: { entityId: null, deletedAt: null },
        select: { id: true, tenantId: true, name: true },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
      });
      if (batch.length === 0) break;

      for (const d of batch) {
        counters.scanned++;
        const normalized = (d.name ?? '').trim();
        if (normalized.length === 0) {
          counters.skippedEmpty++;
          continue;
        }
        const lowered = normalized.toLowerCase();

        const candidates = await prisma.entity.findMany({
          where: {
            tenantId: d.tenantId,
            type: 'document',
            mergedIntoId: null,
          },
          select: { id: true, canonicalName: true },
          take: 200,
        });
        const matched = candidates.find(
          (c) => c.canonicalName.trim().toLowerCase() === lowered,
        );

        let entityId: string;
        if (matched) {
          entityId = matched.id;
          counters.linkedExisting++;
        } else {
          if (DRY_RUN) {
            counters.createdNew++;
            continue;
          }
          const created = await prisma.entity.create({
            data: {
              tenantId: d.tenantId,
              type: 'document',
              canonicalName: normalized,
              mentionsCount: 1,
            },
            select: { id: true },
          });
          entityId = created.id;
          counters.createdNew++;
        }

        if (!DRY_RUN) {
          await prisma.document.update({
            where: { id: d.id },
            data: { entityId },
          });
        }
      }

      cursorId = batch[batch.length - 1]?.id;
      console.log(
        `  ...обработан батч до id=${cursorId}, всего отсканировано=${counters.scanned}`,
      );
      if (batch.length < BATCH_SIZE) break;
    }

    console.log('=== Итоги patch-backfill-entity-id-document ===');
    console.log(`  scanned        : ${counters.scanned}`);
    console.log(`  linkedExisting : ${counters.linkedExisting}`);
    console.log(`  createdNew     : ${counters.createdNew}`);
    console.log(`  skippedEmpty   : ${counters.skippedEmpty}`);
    console.log(`  mode           : ${DRY_RUN ? 'DRY-RUN' : 'REAL'}`);
    /* eslint-enable no-console */
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('patch-backfill-entity-id-document FAILED:', err);
  process.exit(1);
});
