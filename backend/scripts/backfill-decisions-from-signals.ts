import { NestFactory } from '@nestjs/core';
import type { SignalType } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { RouterService } from '../src/modules/knowledge-core/services/router.service';

import { silenceRedisShutdownNoise } from './_lib/silence-redis-shutdown';

interface Options {
  org?: string;
  dryRun: boolean;
  limit: number;
}

const DECISION_SIGNAL_TYPES: SignalType[] = [
  'decision',
  'rationale',
  'decision_basis',
];

const DEFAULT_LIMIT = 1000;

function parseArgs(argv: string[]): Options {
  const opts: Options = { dryRun: argv.includes('--dry-run'), limit: DEFAULT_LIMIT };
  const orgIdx = argv.indexOf('--org');
  if (orgIdx >= 0) {
    const v = argv[orgIdx + 1];
    if (!v || v.startsWith('--')) {
      throw new Error('--org требует значение: --org <orgId>');
    }
    opts.org = v;
  }
  const limitIdx = argv.indexOf('--limit');
  if (limitIdx >= 0) {
    const v = argv[limitIdx + 1];
    if (!v || v.startsWith('--')) {
      throw new Error('--limit требует значение: --limit <N>');
    }
    const num = Number(v);
    if (!Number.isFinite(num) || num <= 0) {
      throw new Error(`--limit должен быть положительным числом, получено: ${v}`);
    }
    opts.limit = Math.floor(num);
  }
  return opts;
}

async function main(opts: Options): Promise<void> {
  console.log(
    `=== backfill-decisions-from-signals START (mode=${opts.dryRun ? 'DRY-RUN' : 'APPLY'}, org=${opts.org ?? '<all>'}, limit=${opts.limit}) ===`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  let scannedBlocks = 0;
  let orphanBlocks = 0;
  let redispatched = 0;

  try {
    const prisma = app.get(PrismaService);
    const router = app.get(RouterService);

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
    console.log(`backfill-decisions-from-signals: организаций к обработке ${orgIds.length}`);

    for (const orgId of orgIds) {
      const blocks = await prisma.ideaBlock.findMany({
        where: {
          tenantId: orgId,
          status: 'canonical',
          signalType: { in: DECISION_SIGNAL_TYPES },
        },
        select: { id: true, signalType: true },
        take: opts.limit,
      });
      scannedBlocks += blocks.length;
      if (blocks.length === 0) continue;

      const blockIds = blocks.map((b) => b.id);

      const withSourceArray = await prisma.decision.findMany({
        where: { tenantId: orgId, sourceBlockIds: { hasSome: blockIds } },
        select: { sourceBlockIds: true },
      });
      const withSourceSingle = await prisma.decision.findMany({
        where: { tenantId: orgId, sourceIdeaBlockId: { in: blockIds } },
        select: { sourceIdeaBlockId: true },
      });

      const materialized = new Set<string>();
      for (const d of withSourceArray) {
        for (const bid of d.sourceBlockIds) materialized.add(bid);
      }
      for (const d of withSourceSingle) {
        if (d.sourceIdeaBlockId) materialized.add(d.sourceIdeaBlockId);
      }

      const orphans = blocks.filter((b) => !materialized.has(b.id));
      orphanBlocks += orphans.length;
      console.log(
        `org=${orgId}: canonical decision-блоков ${blocks.length}, осиротевших ${orphans.length}`,
      );

      for (const block of orphans) {
        if (opts.dryRun) {
          console.log(
            `[DRY-RUN] org=${orgId}: would re-dispatch block=${block.id} (signalType=${block.signalType}) → 3-3-decisions`,
          );
          continue;
        }
        await router.dispatch({
          id: block.id,
          tenantId: orgId,
          signalType: block.signalType,
        });
        redispatched++;
      }
    }

    console.log(
      `=== backfill-decisions-from-signals: orgs=${orgIds.length} scanned=${scannedBlocks} orphan=${orphanBlocks} redispatched=${redispatched} (mode=${opts.dryRun ? 'DRY' : 'APPLY'}) ===`,
    );
  } finally {
    await app.close();
  }
}

const opts = parseArgs(process.argv.slice(2));
silenceRedisShutdownNoise();
main(opts)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('backfill-decisions-from-signals FAILED:', err);
    process.exit(1);
  });
