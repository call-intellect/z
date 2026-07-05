import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { RegulationSummaryService } from '../src/modules/knowledge-core/services/regulation-summary.service';

import { silenceRedisShutdownNoise } from './_lib/silence-redis-shutdown';

interface Options {
  tenantId?: string;
  force: boolean;
  limit: number;
}

function parseArgs(argv: string[]): Options {
  const tenantArg = argv.find((a) => a.startsWith('--tenant='));
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const opts: Options = {
    force: argv.includes('--force'),
    limit: 100000,
  };
  const tenant = tenantArg?.split('=')[1];
  if (tenant) opts.tenantId = tenant;
  const limit = limitArg?.split('=')[1];
  if (limit && Number.isFinite(Number(limit))) opts.limit = Number(limit);
  return opts;
}

export async function main(opts: Options): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const prisma = app.get(PrismaService);
    const summaries = app.get(RegulationSummaryService);

    const orgs = opts.tenantId
      ? [{ id: opts.tenantId }]
      : await prisma.org.findMany({ where: { deletedAt: null }, select: { id: true } });

    let totalGen = 0;
    let totalReuse = 0;
    for (const org of orgs) {
      const res = await summaries.refreshStaleForOrg(org.id, {
        limit: opts.limit,
        force: opts.force,
      });
      totalGen += res.generated;
      totalReuse += res.reused;
      console.log(`  org=${org.id}  generated=${res.generated}  reused=${res.reused}`);
    }
    console.log('=== Итоги backfill-rule-summaries ===');
    console.log(`  orgs      : ${orgs.length}`);
    console.log(`  generated : ${totalGen}`);
    console.log(`  reused    : ${totalReuse}`);
    console.log(`  mode      : ${opts.force ? 'FORCE (пересоздать всё)' : 'stale-only'}`);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  silenceRedisShutdownNoise();
  main(parseArgs(process.argv.slice(2)))
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('backfill-rule-summaries FAILED:', err);
      process.exit(1);
    });
}
