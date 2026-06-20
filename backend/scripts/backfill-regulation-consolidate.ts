import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { RegulationConsolidatorService } from '../src/modules/knowledge-core/services/regulation-consolidator.service';

import { silenceRedisShutdownNoise } from './_lib/silence-redis-shutdown';

interface Options {
  org?: string;
  dryRun: boolean;
}

interface MigrationPairRow {
  process_id: string;
  process_blocks: string[];
  template_id: string;
  template_blocks: string[];
}

const CONSOLIDATE_LIMIT = 1000;
const MIGRATION_COSINE_MIN = 0.85;

function parseArgs(argv: string[]): Options {
  const opts: Options = { dryRun: argv.includes('--dry-run') };
  const orgIdx = argv.indexOf('--org');
  if (orgIdx >= 0) {
    const v = argv[orgIdx + 1];
    if (!v || v.startsWith('--')) {
      throw new Error('--org требует значение: --org <orgId>');
    }
    opts.org = v;
  }
  return opts;
}

function union(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])];
}

const MIGRATION_SQL = `
  SELECT p.id AS process_id, p."sourceBlockIds" AS process_blocks,
         t.id AS template_id, t."sourceBlockIds" AS template_blocks
  FROM "processes" p
  CROSS JOIN LATERAL (
    SELECT pt.id, pt."sourceBlockIds", pt.embedding <=> p.embedding AS dist
    FROM "process_templates" pt
    WHERE pt."tenantId" = p."tenantId" AND pt."deletedAt" IS NULL AND pt.embedding IS NOT NULL
    ORDER BY pt.embedding <=> p.embedding
    LIMIT 1
  ) t
  WHERE p."tenantId" = $1
    AND p.status <> 'deprecated'
    AND p.embedding IS NOT NULL
    AND (1 - t.dist) > ${MIGRATION_COSINE_MIN}
`;

async function main(opts: Options): Promise<void> {
  console.log(
    `=== backfill-regulation-consolidate START (mode=${opts.dryRun ? 'DRY-RUN' : 'APPLY'}, org=${opts.org ?? '<all>'}) ===`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  let scanned = 0;
  let merged = 0;
  let migrated = 0;

  try {
    const prisma = app.get(PrismaService);
    const consolidator = app.get(RegulationConsolidatorService);

    let orgIds: string[];
    if (opts.org) {
      orgIds = [opts.org];
    } else {
      const orgs = await prisma.org.findMany({
        where: {
          deletedAt: null,
          memberships: { some: { role: { in: ['owner', 'admin'] } } },
        },
        select: { id: true },
      });
      orgIds = orgs.map((o) => o.id);
    }
    console.log(`backfill-regulation-consolidate: организаций к обработке ${orgIds.length}`);

    for (const orgId of orgIds) {
      if (opts.dryRun) {
        console.log(`[DRY-RUN] org=${orgId}: часть A (консолидация дублей) пропущена в dry-run`);
      } else {
        const r = await consolidator.consolidateTenant(orgId, CONSOLIDATE_LIMIT);
        merged += r.merged;
        scanned += r.scanned;
        console.log(`org=${orgId}: консолидация — scanned=${r.scanned}, merged=${r.merged}`);
      }

      const pairs = await prisma.$queryRawUnsafe<MigrationPairRow[]>(MIGRATION_SQL, orgId);
      console.log(`org=${orgId}: миграция legacy Process→ProcessTemplate — кандидатов ${pairs.length}`);

      for (const pair of pairs) {
        if (opts.dryRun) {
          console.log(
            `[DRY-RUN] org=${orgId}: would migrate process=${pair.process_id} → template=${pair.template_id}`,
          );
          continue;
        }
        const mergedBlocks = union(pair.template_blocks, pair.process_blocks);
        await prisma.$transaction(async (tx) => {
          await tx.processTemplate.update({
            where: { id: pair.template_id },
            data: { sourceBlockIds: { set: mergedBlocks } },
          });
          await tx.process.update({
            where: { id: pair.process_id },
            data: { status: 'deprecated' },
          });
        });
        migrated++;
      }
    }

    console.log('=== Итоги backfill-regulation-consolidate ===');
    console.log(`  orgs     : ${orgIds.length}`);
    console.log(`  scanned  : ${scanned}`);
    console.log(`  merged   : ${merged}`);
    console.log(`  migrated : ${migrated}`);
    console.log(`  mode     : ${opts.dryRun ? 'DRY-RUN' : 'APPLY'}`);
  } finally {
    await app.close();
  }
}

const opts = parseArgs(process.argv.slice(2));
silenceRedisShutdownNoise();
main(opts)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('backfill-regulation-consolidate FAILED:', err);
    process.exit(1);
  });
