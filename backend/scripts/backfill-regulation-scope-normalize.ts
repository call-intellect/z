import { resolveRoleIdByName } from '../src/modules/knowledge-core/services/entity-resolution.service';

import { createPrismaClient } from './_lib/prisma';

type ScopedTable = 'regulation' | 'instruction' | 'policy' | 'process';

const TABLES: ScopedTable[] = ['regulation', 'instruction', 'policy', 'process'];

interface TableStats {
  scanned: number;
  normalized: number;
  alreadyCanonical: number;
  unresolved: number;
}

function emptyStats(): TableStats {
  return { scanned: 0, normalized: 0, alreadyCanonical: 0, unresolved: 0 };
}

async function processTable(
  prisma: ReturnType<typeof createPrismaClient>,
  table: ScopedTable,
  apply: boolean,
): Promise<TableStats> {
  const stats = emptyStats();
  const delegate = (prisma as Record<string, any>)[table];

  let cursor: string | undefined;
  const pageSize = 500;
  while (true) {
    const rows: Array<{ id: string; tenantId: string; scope: string | null }> =
      await delegate.findMany({
        where: { scope: { startsWith: 'role:' }, deletedAt: null },
        select: { id: true, tenantId: true, scope: true },
        orderBy: { id: 'asc' },
        take: pageSize,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
    if (rows.length === 0) break;

    for (const row of rows) {
      stats.scanned++;
      const raw = row.scope?.trim() ?? '';
      const hint = raw.slice('role:'.length).trim();
      if (!hint) {
        stats.unresolved++;
        continue;
      }
      const existing = await prisma.role.findFirst({
        where: { id: hint, tenantId: row.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (existing) {
        stats.alreadyCanonical++;
        continue;
      }
      const resolvedId = await resolveRoleIdByName(prisma, row.tenantId, hint);
      if (!resolvedId) {
        stats.unresolved++;
        // eslint-disable-next-line no-console
        console.log(
          `  [unresolved] ${table} id=${row.id} tenant=${row.tenantId} scope="${raw}"`,
        );
        continue;
      }
      const nextScope = `role:${resolvedId}`;
      if (nextScope === raw) {
        stats.alreadyCanonical++;
        continue;
      }
      if (apply) {
        await delegate.update({ where: { id: row.id }, data: { scope: nextScope } });
      }
      stats.normalized++;
      // eslint-disable-next-line no-console
      console.log(
        `  [normalize] ${table} id=${row.id} tenant=${row.tenantId} "${raw}" → "${nextScope}"`,
      );
    }
    cursor = rows[rows.length - 1]?.id;
  }
  return stats;
}

async function main(apply: boolean): Promise<void> {
  const prisma = createPrismaClient();
  try {
    // eslint-disable-next-line no-console
    console.log(
      `=== backfill-regulation-scope-normalize START (${apply ? 'APPLY' : 'DRY-RUN'}) ===`,
    );
    const totals = emptyStats();
    for (const table of TABLES) {
      const stats = await processTable(prisma, table, apply);
      // eslint-disable-next-line no-console
      console.log(
        `[${table}] scanned=${stats.scanned} normalized=${stats.normalized} alreadyCanonical=${stats.alreadyCanonical} unresolved=${stats.unresolved}`,
      );
      totals.scanned += stats.scanned;
      totals.normalized += stats.normalized;
      totals.alreadyCanonical += stats.alreadyCanonical;
      totals.unresolved += stats.unresolved;
    }
    // eslint-disable-next-line no-console
    console.log(
      `=== DONE scanned=${totals.scanned} normalized=${totals.normalized} alreadyCanonical=${totals.alreadyCanonical} unresolved=${totals.unresolved} (${apply ? 'APPLIED' : 'DRY-RUN, без записи'}) ===`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

const apply = process.argv.includes('--apply');
main(apply)
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('backfill-regulation-scope-normalize FAILED:', err);
    process.exit(1);
  });
