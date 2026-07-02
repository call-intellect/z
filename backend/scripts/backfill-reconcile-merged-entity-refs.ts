import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { EntityMergeService } from '../src/modules/knowledge-core/services/entity-merge.service';

import { silenceRedisShutdownNoise } from './_lib/silence-redis-shutdown';

interface Options {
  apply: boolean;
  tenantId?: string;
}

function parseArgs(argv: string[]): Options {
  const apply = argv.includes('--apply');
  const tenantArg = argv.find((a) => a.startsWith('--tenant='));
  const opts: Options = { apply };
  if (tenantArg) {
    const v = tenantArg.split('=')[1];
    if (v) opts.tenantId = v;
  }
  return opts;
}

async function main(opts: Options): Promise<void> {
  console.log(
    `=== backfill-reconcile-merged-entity-refs START ` +
      `(apply=${opts.apply}, tenant=${opts.tenantId ?? '<all>'}) ===`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const prisma = app.get(PrismaService);
    const mergeSvc = app.get(EntityMergeService);

    const orgs = opts.tenantId
      ? [{ id: opts.tenantId }]
      : await prisma.org.findMany({ select: { id: true }, orderBy: { id: 'asc' } });

    console.log(`Организаций к обработке: ${orgs.length}`);

    let totalScanned = 0;
    let totalReconciled = 0;

    for (const org of orgs) {
      if (!opts.apply) {
        const merged = await prisma.entity.count({
          where: { tenantId: org.id, mergedIntoId: { not: null } },
        });
        totalScanned += merged;
        if (merged > 0) console.log(`  [dry-run] tenant=${org.id} слитых сущностей=${merged}`);
        continue;
      }
      const res = await mergeSvc.reconcileEntityRefs(org.id);
      totalScanned += res.scanned;
      totalReconciled += res.reconciled;
      if (res.scanned > 0) {
        console.log(
          `  tenant=${org.id} scanned=${res.scanned} reconciled=${res.reconciled}`,
        );
      }
    }

    console.log('=== SUMMARY ===');
    if (opts.apply) {
      console.log(
        `mode=apply orgs=${orgs.length} scanned=${totalScanned} reconciled=${totalReconciled}`,
      );
    } else {
      console.log(
        `mode=dry-run orgs=${orgs.length} scanned=${totalScanned} (ничего не изменено)`,
      );
    }
    console.log('=== backfill-reconcile-merged-entity-refs DONE ===');
  } finally {
    await app.close();
  }
}

const opts = parseArgs(process.argv.slice(2));
silenceRedisShutdownNoise();
main(opts)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('backfill-reconcile-merged-entity-refs FAILED:', err);
    process.exit(1);
  });
