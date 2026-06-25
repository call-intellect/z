import { createPrismaClient } from './_lib/prisma';
import { isJunkEntityName } from '../src/modules/knowledge-core/services/entity-name-quality';

const apply = process.argv.includes('--apply');

const BATCH_SIZE = 500;
const SAMPLE_LIMIT = 50;

interface Candidate {
  id: string;
  tenantId: string;
  type: string;
  canonicalName: string;
  mentionsCount: number;
}

async function collectCandidates(
  prisma: ReturnType<typeof createPrismaClient>,
): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  let cursorId: string | null = null;

  for (;;) {
    const batch: Candidate[] = await prisma.entity.findMany({
      where: {
        vendor: { is: null },
        customer: { is: null },
        event: { is: null },
        goal: { is: null },
        document: { is: null },
        market: { is: null },
        orgUnit: { is: null },
        role: { is: null },
        department: { is: null },
        persons: { none: {} },
        ...(cursorId ? { id: { gt: cursorId } } : {}),
      },
      select: { id: true, tenantId: true, type: true, canonicalName: true, mentionsCount: true },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
    });

    for (const e of batch) {
      if (isJunkEntityName(e.canonicalName)) {
        candidates.push({
          id: e.id,
          tenantId: e.tenantId,
          type: e.type,
          canonicalName: e.canonicalName,
          mentionsCount: e.mentionsCount,
        });
      }
    }

    if (batch.length < BATCH_SIZE) break;
    const last = batch[batch.length - 1];
    if (!last) break;
    cursorId = last.id;
  }

  return candidates;
}

async function purgeCandidate(
  prisma: ReturnType<typeof createPrismaClient>,
  c: Candidate,
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const delLinks = await tx.entityLink.deleteMany({
      where: {
        tenantId: c.tenantId,
        OR: [
          { fromEntityId: c.id, OR: [{ fromType: null }, { fromType: 'entity' }] },
          { toEntityId: c.id, OR: [{ toType: null }, { toType: 'entity' }] },
        ],
      },
    });
    await tx.entity.delete({ where: { id: c.id } });
    return delLinks.count;
  });
}

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  const log = (m: string): void => console.log(m);

  let deletedEntities = 0;
  let deletedLinks = 0;
  let failed = 0;

  try {
    log(`=== backfill-purge-junk-entities START (${apply ? 'APPLY' : 'DRY-RUN'}) ===`);

    const candidates = await collectCandidates(prisma);
    log(`Кандидатов на удаление: ${candidates.length}`);

    if (!apply) {
      const sample = candidates.slice(0, SAMPLE_LIMIT);
      for (const c of sample) {
        log(`  [${c.type}] ${c.canonicalName} · mentions=${c.mentionsCount}`);
      }
      if (candidates.length > SAMPLE_LIMIT) {
        log(`  …и ещё ${candidates.length - SAMPLE_LIMIT}`);
      }
    } else {
      for (const c of candidates) {
        try {
          const links = await purgeCandidate(prisma, c);
          deletedEntities++;
          deletedLinks += links;
        } catch (err) {
          failed++;
          log(`  WARN: не удалось удалить Entity ${c.id}: ${String(err)}`);
        }
      }
    }

    log('=== SUMMARY ===');
    if (apply) {
      log(
        `mode=apply candidates=${candidates.length} deletedEntities=${deletedEntities} ` +
          `deletedLinks=${deletedLinks} failed=${failed}`,
      );
    } else {
      log(`mode=dry-run candidates=${candidates.length} (ничего не удалено)`);
    }
    log('=== backfill-purge-junk-entities DONE ===');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('backfill-purge-junk-entities FAILED:', err);
  process.exit(1);
});
