import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

async function main(): Promise<void> {
  const orgId = process.argv[2];
  if (!orgId) {
    // eslint-disable-next-line no-console
    console.log('Usage: tsx scripts/benchmark-knowledge-core.ts <orgId>');
    // eslint-disable-next-line no-console
    console.log('\nBenchmark TBD. См. docs/benchmarks/knowledge-core-baseline.md.');
    process.exit(2);
  }

  const org = await prisma.org.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, slug: true, deletedAt: true },
  });
  if (!org) {
    // eslint-disable-next-line no-console
    console.error(`Org ${orgId} не найдена`);
    process.exit(1);
  }
  if (org.deletedAt) {
    // eslint-disable-next-line no-console
    console.warn(`WARN: Org ${orgId} помечена deletedAt=${org.deletedAt.toISOString()}`);
  }

  // eslint-disable-next-line no-console
  console.log(`=== knowledge-core benchmark для Org "${org.name}" (${org.id}) ===`);

  const [
    blocksTotal,
    blocksDraft,
    blocksCanonical,
    blocksMerged,
    blocksArchived,
    entitiesTotal,
    entitiesMerged,
    evidenceTotal,
    blockEntityTotal,
    rawEventsTotal,
  ] = await Promise.all([
    prisma.ideaBlock.count({ where: { tenantId: orgId } }),
    prisma.ideaBlock.count({ where: { tenantId: orgId, status: 'draft' } }),
    prisma.ideaBlock.count({ where: { tenantId: orgId, status: 'canonical' } }),
    prisma.ideaBlock.count({ where: { tenantId: orgId, status: 'merged_into' } }),
    prisma.ideaBlock.count({ where: { tenantId: orgId, status: 'archived' } }),
    prisma.entity.count({ where: { tenantId: orgId } }),
    prisma.entity.count({ where: { tenantId: orgId, NOT: { mergedIntoId: null } } }),
    prisma.ideaBlockEvidence.count({ where: { block: { tenantId: orgId } } }),
    prisma.ideaBlockEntity.count({ where: { block: { tenantId: orgId } } }),
    prisma.rawEvent.count({ where: { tenantId: orgId } }),
  ]);

  const compressionRatio = blocksTotal > 0 ? (blocksCanonical / blocksTotal).toFixed(3) : 'n/a';

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        org: { id: org.id, name: org.name, slug: org.slug },
        ideaBlocks: {
          total: blocksTotal,
          draft: blocksDraft,
          canonical: blocksCanonical,
          merged_into: blocksMerged,
          archived: blocksArchived,
          canonicalRatio: compressionRatio,
        },
        entities: {
          total: entitiesTotal,
          mergedAway: entitiesMerged,
          active: entitiesTotal - entitiesMerged,
        },
        relations: {
          evidence: evidenceTotal,
          blockEntity: blockEntityTotal,
        },
        rawEvents: rawEventsTotal,
      },
      null,
      2,
    ),
  );

  // eslint-disable-next-line no-console
  console.log('\n=== TODO ===');
  // eslint-disable-next-line no-console
  console.log(
    'Полный бенчмарк (golden-set, top-3 hit rate, сравнение с chunk RAG)\n' +
      'не реализован. План — docs/benchmarks/knowledge-core-baseline.md.',
  );
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('benchmark FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
