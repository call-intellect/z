import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { TableGraphSyncService } from '../src/modules/tables/services/table-graph-sync.service';
import { SYSTEM_TABLES_CATALOG } from '../src/modules/tables/templates/system-tables.catalog';

import { silenceRedisShutdownNoise } from './_lib/silence-redis-shutdown';

interface RunArgs {
  orgId?: string;
}

const GRAPHSYNC_SYSTEM_KEYS = new Set<string>(
  SYSTEM_TABLES_CATALOG.filter((t) => t.graphSync).map((t) => t.systemKey),
);

function graphSyncBySystemKey(systemKey: string): Prisma.InputJsonValue | null {
  const tpl = SYSTEM_TABLES_CATALOG.find((t) => t.systemKey === systemKey);
  if (!tpl?.graphSync) return null;
  return tpl.graphSync as unknown as Prisma.InputJsonValue;
}

async function backfillConfig(prisma: PrismaService): Promise<number> {
  const tables = await prisma.table.findMany({
    where: {
      isSystem: true,
      systemKey: { in: [...GRAPHSYNC_SYSTEM_KEYS] },
    },
    select: { id: true, systemKey: true },
  });
  let patched = 0;
  for (const t of tables) {
    if (!t.systemKey) continue;
    const value = graphSyncBySystemKey(t.systemKey);
    if (!value) continue;
    await prisma.table.update({
      where: { id: t.id },
      data: { graphSync: value },
    });
    patched++;
  }
  return patched;
}

async function main(args: RunArgs): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const prisma = app.get(PrismaService);
    const graphSync = app.get(TableGraphSyncService);

    console.log(`=== backfill-table-graphsync START (orgId=${args.orgId ?? 'ALL'}) ===`);

    const patchedConfig = await backfillConfig(prisma);
    console.log(`config: proставлено graphSync у ${patchedConfig} системных таблиц`);

    const orgs = args.orgId
      ? [{ id: args.orgId }]
      : await prisma.org.findMany({ where: { deletedAt: null }, select: { id: true } });

    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const org of orgs) {
      const res = await graphSync.reconcileTenant(org.id);
      created += res.created;
      updated += res.updated;
      skipped += res.skipped;
      console.log(
        `[org ${org.id}] created=${res.created}, updated=${res.updated}, skipped=${res.skipped}`,
      );
    }

    console.log(
      `=== DONE orgs=${orgs.length}, created=${created}, updated=${updated}, skipped=${skipped} ===`,
    );
  } finally {
    await app.close();
  }
}

function parseArgs(argv: string[]): RunArgs {
  let orgId: string | undefined;
  for (const a of argv) {
    if (a.startsWith('--org=')) orgId = a.slice('--org='.length).trim() || undefined;
  }
  return { orgId };
}

if (require.main === module) {
  silenceRedisShutdownNoise();
  main(parseArgs(process.argv.slice(2)))
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('backfill-table-graphsync FAILED:', err);
      process.exit(1);
    });
}

export { backfillConfig };
