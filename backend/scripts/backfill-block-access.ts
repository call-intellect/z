import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { BlockAccessDeriverService } from '../src/modules/knowledge-core/services/block-access-deriver.service';
import { S3Service } from '../src/modules/recordings/s3.service';

import { createPrismaClient } from './_lib/prisma';
import { silenceRedisShutdownNoise } from './_lib/silence-redis-shutdown';

const BATCH_SIZE = 200;

interface Options {
  tenantId?: string;
  limit?: number;
  dryRun: boolean;
  departments: boolean;
}

interface Stats {
  scanned: number;
  derived: number;
  skipped: number;
}

function parseArgs(argv: string[]): Options {
  const tenantArg = argv.find((a) => a.startsWith('--tenant='));
  const limitArg = argv.find((a) => a.startsWith('--limit='));

  const opts: Options = {
    dryRun: argv.includes('--dry-run'),
    departments: argv.includes('--departments'),
  };

  if (tenantArg) {
    const v = tenantArg.split('=')[1];
    if (v) opts.tenantId = v;
  }
  if (limitArg) {
    const v = limitArg.split('=')[1];
    if (v) {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`Invalid --limit value: "${v}" (expected positive integer)`);
      }
      opts.limit = Math.floor(n);
    }
  }
  return opts;
}

async function main(opts: Options): Promise<void> {
  console.log(
    `=== backfill-block-access START ` +
      `(departments=${opts.departments}, dryRun=${opts.dryRun}, ` +
      `tenant=${opts.tenantId ?? '<all>'}, limit=${opts.limit ?? '<none>'}) ===`,
  );

  if (!opts.departments) {
    console.log(
      'backfill-block-access: флаг --departments не передан — историческое знание ' +
        'остаётся «открыто всей компании» (решение В5). Ничего не делаем (no-op).',
    );
    return;
  }

  const blockWhere = {
    status: 'canonical' as const,
    blockAccess: { none: {} },
    ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
  };

  const preCheck = createPrismaClient();
  try {
    const pending = await preCheck.ideaBlock.count({ where: blockWhere });
    if (pending === 0) {
      console.log(
        'backfill-block-access: нет canonical-блоков без IdeaBlockAccess — backfill не требуется.',
      );
      return;
    }
    console.log(`backfill-block-access: кандидатов-блоков ${pending}`);
  } finally {
    await preCheck.$disconnect();
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const stats: Stats = { scanned: 0, derived: 0, skipped: 0 };

  try {
    const prisma = app.get(PrismaService);
    const deriver = app.get(BlockAccessDeriverService);
    const s3 = app.get(S3Service);

    const payloadCache = new Map<string, unknown>();
    const loadPayload = async (event: {
      id: string;
      payloadStorage: string;
      payload: unknown;
      payloadS3Key: string | null;
    }): Promise<unknown> => {
      if (payloadCache.has(event.id)) return payloadCache.get(event.id);
      let result: unknown;
      if (event.payloadStorage === 's3') {
        if (!event.payloadS3Key) {
          throw new Error(`RawEvent ${event.id}: payloadStorage=s3, но payloadS3Key пустой`);
        }
        result = await s3.getJson<unknown>(event.payloadS3Key);
      } else {
        result = event.payload;
      }
      payloadCache.set(event.id, result);
      return result;
    };

    let cursorId: string | undefined = undefined;
    let processed = 0;
    while (true) {
      if (opts.limit && processed >= opts.limit) break;
      const take = opts.limit ? Math.min(BATCH_SIZE, opts.limit - processed) : BATCH_SIZE;

      const batch = await prisma.ideaBlock.findMany({
        where: blockWhere,
        select: { id: true, tenantId: true },
        orderBy: { id: 'asc' },
        take,
        ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
      });
      if (batch.length === 0) break;

      for (const block of batch) {
        stats.scanned++;
        processed++;
        try {
          let payload: unknown = null;
          const evidence = await prisma.ideaBlockEvidence.findFirst({
            where: { blockId: block.id },
            orderBy: { createdAt: 'asc' },
            select: { rawEventId: true },
          });
          if (evidence) {
            const event = await prisma.rawEvent.findUnique({
              where: { id: evidence.rawEventId },
              select: {
                id: true,
                payloadStorage: true,
                payload: true,
                payloadS3Key: true,
              },
            });
            if (event) payload = await loadPayload(event);
          }

          if (opts.dryRun) {
            console.log(
              `[DRY-RUN] would deriveDepartmentsOnly blockId=${block.id} tenantId=${block.tenantId}`,
            );
            stats.derived++;
            continue;
          }

          await deriver.deriveDepartmentsOnly({
            tenantId: block.tenantId,
            blockId: block.id,
            payload,
          });
          stats.derived++;
        } catch (err) {
          stats.skipped++;
          console.warn(
            `[error] blockId=${block.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      cursorId = batch[batch.length - 1]?.id;
      if (batch.length < take) break;
    }

    console.log('=== Итоги backfill-block-access ===');
    console.log(`  scanned : ${stats.scanned}`);
    console.log(`  derived : ${stats.derived}`);
    console.log(`  skipped : ${stats.skipped}`);
    console.log(`  mode    : ${opts.dryRun ? 'DRY-RUN' : 'APPLY'}`);
  } finally {
    await app.close();
  }
}

const opts = parseArgs(process.argv.slice(2));
silenceRedisShutdownNoise();
main(opts)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('backfill-block-access FAILED:', err);
    process.exit(1);
  });
