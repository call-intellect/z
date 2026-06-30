import { NestFactory } from '@nestjs/core';

import { CryptoService } from '../src/common/crypto/crypto.service';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import { stripToPlain } from '../src/modules/messaging/services/strip-to-plain';

import { silenceRedisShutdownNoise } from './_lib/silence-redis-shutdown';

const BATCH_SIZE = 200;

interface Options {
  limit?: number;
  dryRun: boolean;
}

interface Stats {
  scanned: number;
  updated: number;
  skipped: number;
}

function parseArgs(argv: string[]): Options {
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const opts: Options = { dryRun: argv.includes('--dry-run') };
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
    `=== backfill-message-contentstripped START (dryRun=${opts.dryRun}, limit=${
      opts.limit ?? '<none>'
    }) ===`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const stats: Stats = { scanned: 0, updated: 0, skipped: 0 };

  try {
    const prisma = app.get(PrismaService);
    const crypto = app.get(CryptoService);

    const where = { contentStripped: null };
    const pending = await prisma.message.count({ where });
    if (pending === 0) {
      console.log('backfill-message-contentstripped: нет сообщений без contentStripped — no-op.');
      return;
    }
    console.log(`backfill-message-contentstripped: кандидатов ${pending}`);

    let cursorId: string | undefined = undefined;
    let processed = 0;
    while (true) {
      if (opts.limit && processed >= opts.limit) break;
      const take = opts.limit ? Math.min(BATCH_SIZE, opts.limit - processed) : BATCH_SIZE;

      const batch = await prisma.message.findMany({
        where,
        select: { id: true, content: true },
        orderBy: { id: 'asc' },
        take,
        ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
      });
      if (batch.length === 0) break;

      for (const message of batch) {
        stats.scanned++;
        processed++;
        try {
          const plain = stripToPlain(crypto.decrypt(message.content));
          if (plain.length === 0) {
            stats.skipped++;
            continue;
          }
          if (opts.dryRun) {
            stats.updated++;
            continue;
          }
          await prisma.message.update({
            where: { id: message.id },
            data: { contentStripped: plain },
          });
          stats.updated++;
        } catch (err) {
          stats.skipped++;
          console.warn(
            `[error] messageId=${message.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      cursorId = batch[batch.length - 1]?.id;
      if (batch.length < take) break;
    }

    console.log('=== Итоги backfill-message-contentstripped ===');
    console.log(`  scanned : ${stats.scanned}`);
    console.log(`  updated : ${stats.updated}`);
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
    console.error('backfill-message-contentstripped FAILED:', err);
    process.exit(1);
  });
