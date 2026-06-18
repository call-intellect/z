import { NestFactory } from '@nestjs/core';
import type { SignalType } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { CoreQueueService } from '../src/modules/core-queue/core-queue.service';

import { createPrismaClient } from './_lib/prisma';
import { silenceRedisShutdownNoise } from './_lib/silence-redis-shutdown';

const SIGNAL_TYPES = ['expertise', 'experience', 'competence'] as const;

interface Options {
  tenantId?: string;
  since?: Date;
  limit?: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Options {
  const tenantArg = argv.find((a) => a.startsWith('--tenant='));
  const sinceArg = argv.find((a) => a.startsWith('--since='));
  const limitArg = argv.find((a) => a.startsWith('--limit='));

  const opts: Options = { dryRun: argv.includes('--dry-run') };

  if (tenantArg) {
    const v = tenantArg.split('=')[1];
    if (v) opts.tenantId = v;
  }
  if (sinceArg) {
    const v = sinceArg.split('=')[1];
    if (v) {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) {
        throw new Error(`Invalid --since date: "${v}" (expected ISO YYYY-MM-DD)`);
      }
      opts.since = d;
    }
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
    `=== backfill-knowledge-clone-after-router-fix START ` +
      `(dryRun=${opts.dryRun}, tenant=${opts.tenantId ?? '<all>'}, ` +
      `since=${opts.since?.toISOString() ?? '<all>'}, ` +
      `limit=${opts.limit ?? '<none>'}) ===`,
  );

  const matchWhere = {
    relationship: 'employee' as const,
    deletedAt: null,
    ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
    entity: {
      blockMentions: {
        some: {
          role: 'subject' as const,
          block: {
            signalType: { in: SIGNAL_TYPES as unknown as SignalType[] },
            status: 'canonical' as const,
            ...(opts.since ? { createdAt: { gte: opts.since } } : {}),
          },
        },
      },
    },
  };
  const preCheck = createPrismaClient();
  try {
    const pending = await preCheck.person.count({ where: matchWhere });
    if (pending === 0) {
      console.log(
        'backfill-knowledge-clone-after-router-fix: нет сотрудников с expertise/experience/competence-блоками — обновление не требуется.',
      );
      return;
    }
    console.log(`backfill-knowledge-clone-after-router-fix: кандидатов ${pending}`);
  } finally {
    await preCheck.$disconnect();
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const prisma = app.get(PrismaService);
    const coreQueue = app.get(CoreQueueService);

    const employees = await prisma.person.findMany({
      where: matchWhere,
      select: { id: true, tenantId: true },
      ...(opts.limit ? { take: opts.limit } : {}),
    });

    console.log(
      `Found ${employees.length} employee(s) with expertise/experience/competence canonical blocks`,
    );

    if (opts.dryRun) {
      console.log('Dry-run mode: no enqueue. Exiting.');
      return;
    }

    let enqueued = 0;
    let errors = 0;
    for (const emp of employees) {
      try {
        await coreQueue.enqueueRebuildKnowledgeProfile({
          personId: emp.id,
          tenantId: emp.tenantId,
          reason: 'backfill-router-fix-knowledge-clone',
          delayMs: 0,
        });
        enqueued++;
        if (enqueued % 50 === 0) {
          console.log(`progress: enqueued=${enqueued}/${employees.length}, errors=${errors}`);
        }
      } catch (err) {
        errors++;
        console.warn(
          `[error] personId=${emp.id} tenantId=${emp.tenantId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    console.log(
      `=== DONE total=${employees.length}, enqueued=${enqueued}, errors=${errors} ` +
        `(existing jobId+debounce will dedupe duplicates) ===`,
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
    console.error('backfill-knowledge-clone-after-router-fix FAILED:', err);
    process.exit(1);
  });
