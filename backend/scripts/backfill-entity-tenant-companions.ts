import type { PrismaClient } from '@prisma/client';

import { createPrismaClient } from './_lib/prisma';

const PERSON_WHERE = '"entityId" IS NOT NULL AND "entityTenantId" IS NULL';
const ENTITY_WHERE = '"mergedIntoId" IS NOT NULL AND "mergedIntoTenantId" IS NULL';
const BLOCK_WHERE = '"mergedIntoId" IS NOT NULL AND "mergedIntoTenantId" IS NULL';

const PERSON_UPDATE = `UPDATE persons SET "entityTenantId" = "tenantId" WHERE ${PERSON_WHERE}`;
const ENTITY_UPDATE = `UPDATE "Entity" SET "mergedIntoTenantId" = "tenantId" WHERE ${ENTITY_WHERE}`;
const BLOCK_UPDATE = `UPDATE "IdeaBlock" SET "mergedIntoTenantId" = "tenantId" WHERE ${BLOCK_WHERE}`;

const PERSON_COUNT = `SELECT count(*)::bigint AS count FROM persons WHERE ${PERSON_WHERE}`;
const ENTITY_COUNT = `SELECT count(*)::bigint AS count FROM "Entity" WHERE ${ENTITY_WHERE}`;
const BLOCK_COUNT = `SELECT count(*)::bigint AS count FROM "IdeaBlock" WHERE ${BLOCK_WHERE}`;

async function countRows(prisma: PrismaClient, sql: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(sql);
  return Number(rows[0]?.count ?? 0n);
}

export async function backfillEntityTenantCompanions(
  prisma: PrismaClient,
  apply: boolean,
): Promise<{ persons: number; entities: number; blocks: number }> {
  if (!apply) {
    const [persons, entities, blocks] = await Promise.all([
      countRows(prisma, PERSON_COUNT),
      countRows(prisma, ENTITY_COUNT),
      countRows(prisma, BLOCK_COUNT),
    ]);
    return { persons, entities, blocks };
  }
  const persons = await prisma.$executeRawUnsafe(PERSON_UPDATE);
  const entities = await prisma.$executeRawUnsafe(ENTITY_UPDATE);
  const blocks = await prisma.$executeRawUnsafe(BLOCK_UPDATE);
  return { persons, entities, blocks };
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const prisma = createPrismaClient();
  const log = (m: string): void => console.log(m);

  try {
    log(`=== backfill-entity-tenant-companions START (${apply ? 'APPLY' : 'DRY-RUN'}) ===`);
    const res = await backfillEntityTenantCompanions(prisma, apply);
    log('=== SUMMARY ===');
    if (apply) {
      log(
        `mode=apply updated persons=${res.persons} entities=${res.entities} blocks=${res.blocks}`,
      );
    } else {
      log(
        `mode=dry-run would-update persons=${res.persons} entities=${res.entities} blocks=${res.blocks}`,
      );
    }
    log('=== backfill-entity-tenant-companions DONE ===');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('backfill-entity-tenant-companions FAILED:', err);
    process.exit(1);
  });
}
