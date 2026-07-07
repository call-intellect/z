import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { EntityConsolidateSameNameCronService } from '../src/modules/knowledge-core/workers/entity-consolidate-same-name.cron';

import { silenceRedisShutdownNoise } from './_lib/silence-redis-shutdown';

const DEFAULT_BATCH_SIZE = 200;

interface RunArgs {
  org?: string;
  batchSize: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): RunArgs {
  const orgArg = argv.find((a) => a.startsWith('--org='));
  const org = orgArg ? orgArg.slice('--org='.length) : undefined;
  const batchArg = argv.find((a) => a.startsWith('--batch-size='));
  const batchSize = batchArg ? Number(batchArg.slice('--batch-size='.length)) : DEFAULT_BATCH_SIZE;
  const dryRun = argv.includes('--dry-run');
  return { org, batchSize: Number.isFinite(batchSize) ? batchSize : DEFAULT_BATCH_SIZE, dryRun };
}

async function main(args: RunArgs): Promise<void> {
  console.log(
    `=== backfill-entity-consolidate-same-name START (org=${args.org ?? 'ALL'}, batchSize=${args.batchSize}, dryRun=${args.dryRun}) ===`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const cron = app.get(EntityConsolidateSameNameCronService);
    const summary = args.org
      ? await cron.runForOneOrg(args.org, args.batchSize, args.dryRun)
      : await cron.runForAllOrgs(args.dryRun);
    console.log(
      `scannedOrgs=${summary.scannedOrgs}, groups=${summary.groups}, merged=${summary.merged}, distinct=${summary.distinct}, errors=${summary.errors}`,
    );
    if (args.dryRun) {
      console.log('DRY-RUN: merge/distinct не применялись, только подсчёт групп.');
    }
  } finally {
    await app.close();
  }

  console.log('=== backfill-entity-consolidate-same-name DONE ===');
}

silenceRedisShutdownNoise();
main(parseArgs(process.argv))
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('backfill-entity-consolidate-same-name FAILED:', err);
    process.exit(1);
  });
