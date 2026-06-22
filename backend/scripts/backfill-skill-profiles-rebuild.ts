import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { CoreQueueService } from '../src/modules/core-queue/core-queue.service';

import { createPrismaClient } from './_lib/prisma';
import { silenceRedisShutdownNoise } from './_lib/silence-redis-shutdown';

const PAGE_SIZE = 200;
const MAX_PAGES = 1000;

interface Options {
  tenantId?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Options {
  const tenantArg = argv.find((a) => a.startsWith('--tenant='));

  const opts: Options = { dryRun: argv.includes('--dry-run') };

  if (tenantArg) {
    const v = tenantArg.split('=')[1];
    if (v) opts.tenantId = v;
  }
  return opts;
}

async function main(opts: Options): Promise<void> {
  console.log(
    `=== backfill-skill-profiles-rebuild START ` +
      `(dryRun=${opts.dryRun}, tenant=${opts.tenantId ?? '<all>'}) ===`,
  );

  const profileWhere = {
    status: 'active' as const,
    ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
  };

  const preCheck = createPrismaClient();
  try {
    const pending = await preCheck.skillProfile.count({ where: profileWhere });
    if (pending === 0) {
      console.log(
        'backfill-skill-profiles-rebuild: нет active-профилей — форс-пересборка не требуется.',
      );
      return;
    }
    console.log(`backfill-skill-profiles-rebuild: active-профилей ${pending}`);
  } finally {
    await preCheck.$disconnect();
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const prisma = app.get(PrismaService);
    const coreQueue = app.get(CoreQueueService);

    let total = 0;
    let enqueued = 0;
    let errors = 0;
    let cursorId: string | null = null;

    for (let page = 0; page < MAX_PAGES; page++) {
      const profiles = await prisma.skillProfile.findMany({
        where: profileWhere,
        select: { id: true, tenantId: true },
        orderBy: { id: 'asc' },
        take: PAGE_SIZE,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      });
      if (profiles.length === 0) break;
      cursorId = profiles[profiles.length - 1]!.id;

      for (const p of profiles) {
        total++;
        if (opts.dryRun) {
          enqueued++;
          continue;
        }
        try {
          await coreQueue.enqueueRebuildSkillProfile({
            profileId: p.id,
            tenantId: p.tenantId,
            reason: 'backfill-methodology-step',
            delayMs: 0,
          });
          enqueued++;
          if (enqueued % 50 === 0) {
            console.log(`progress: enqueued=${enqueued}/${total}, errors=${errors}`);
          }
        } catch (err) {
          errors++;
          console.warn(
            `[error] profileId=${p.id} tenantId=${p.tenantId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (profiles.length < PAGE_SIZE) break;
    }

    if (opts.dryRun) {
      console.log(`Dry-run mode: поставил бы rebuild для ${enqueued} active-профилей. No enqueue.`);
    }

    console.log(
      `=== DONE total=${total}, enqueued=${enqueued}, errors=${errors} ` +
        `(jobId-дедуп: повторный прогон = no-op) ===`,
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
    console.error('backfill-skill-profiles-rebuild FAILED:', err);
    process.exit(1);
  });
