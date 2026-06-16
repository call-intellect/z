import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';
import { isColumnNullable } from './_lib/schema-guards';

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 1000;

interface Counters {
  scanned: number;
  linkedExisting: number;
  createdNew: number;
  skippedEmpty: number;
}

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  const counters: Counters = {
    scanned: 0,
    linkedExisting: 0,
    createdNew: 0,
    skippedEmpty: 0,
  };

  try {
    /* eslint-disable no-console */
    console.log(`=== patch-backfill-entity-id-person START (${DRY_RUN ? 'DRY-RUN' : 'REAL'}) ===`);

    if (!(await isColumnNullable(prisma, 'Person', 'entityId'))) {
      console.log(
        'Person.entityId уже NOT NULL — backfill применён ранее, обновление не требуется.',
      );
      return;
    }

    let cursorId: string | undefined = undefined;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const batch = await prisma.person.findMany({
        where: { entityId: null, deletedAt: null },
        select: { id: true, tenantId: true, name: true },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
      });
      if (batch.length === 0) break;

      for (const p of batch) {
        counters.scanned++;
        const normalized = (p.name ?? '').trim();
        if (normalized.length === 0) {
          counters.skippedEmpty++;
          continue;
        }
        const lowered = normalized.toLowerCase();

        const candidates = await prisma.entity.findMany({
          where: {
            tenantId: p.tenantId,
            type: 'person',
            mergedIntoId: null,
          },
          select: { id: true, canonicalName: true },
          take: 200,
        });
        const matched = candidates.find((c) => c.canonicalName.trim().toLowerCase() === lowered);

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
              tenantId: p.tenantId,
              type: 'person',
              canonicalName: normalized,
              mentionsCount: 1,
            },
            select: { id: true },
          });
          entityId = created.id;
          counters.createdNew++;
        }

        if (!DRY_RUN) {
          await prisma.person.update({
            where: { id: p.id },
            data: { entityId },
          });
        }
      }

      cursorId = batch[batch.length - 1]?.id;
      console.log(`  ...обработан батч до id=${cursorId}, всего отсканировано=${counters.scanned}`);
      if (batch.length < BATCH_SIZE) break;
    }

    console.log('=== Итоги patch-backfill-entity-id-person ===');
    console.log(`  scanned        : ${counters.scanned}`);
    console.log(`  linkedExisting : ${counters.linkedExisting}`);
    console.log(`  createdNew     : ${counters.createdNew}`);
    console.log(`  skippedEmpty   : ${counters.skippedEmpty}`);
    console.log(`  mode           : ${DRY_RUN ? 'DRY-RUN (no writes)' : 'REAL'}`);
    /* eslint-enable no-console */
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('patch-backfill-entity-id-person FAILED:', err);
  process.exit(1);
});
