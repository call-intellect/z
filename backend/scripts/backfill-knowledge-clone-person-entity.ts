import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { EntityResolutionService } from '../src/modules/knowledge-core/services/entity-resolution.service';

import { createPrismaClient } from './_lib/prisma';
import { silenceRedisShutdownNoise } from './_lib/silence-redis-shutdown';

interface Options {
  apply: boolean;
  tenantId?: string;
  limit?: number;
}

function parseArgs(argv: string[]): Options {
  const apply = argv.includes('--apply');
  const tenantArg = argv.find((a) => a.startsWith('--tenant='));
  const limitArg = argv.find((a) => a.startsWith('--limit='));

  const opts: Options = { apply };

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
    `=== backfill-knowledge-clone-person-entity START ` +
      `(apply=${opts.apply}, tenant=${opts.tenantId ?? '<all>'}, ` +
      `limit=${opts.limit ?? '<none>'}) ===`,
  );

  const matchWhere = {
    entityId: null,
    deletedAt: null,
    ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
  };

  const preCheck = createPrismaClient();
  try {
    const pending = await preCheck.person.count({ where: matchWhere });
    if (pending === 0) {
      console.log(
        'backfill-knowledge-clone-person-entity: нет Person с entityId IS NULL — обновление не требуется.',
      );
      return;
    }
    console.log(`backfill-knowledge-clone-person-entity: кандидатов ${pending}`);
  } finally {
    await preCheck.$disconnect();
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const prisma = app.get(PrismaService);
    const entities = app.get(EntityResolutionService);

    const persons = await prisma.person.findMany({
      where: matchWhere,
      select: { id: true, tenantId: true },
      ...(opts.limit ? { take: opts.limit } : {}),
    });

    console.log(`Found ${persons.length} person(s) with entityId IS NULL`);

    if (!opts.apply) {
      console.log('Dry-run mode: no update. Sample:');
      for (const p of persons.slice(0, 10)) {
        console.log(`  personId=${p.id} tenantId=${p.tenantId}`);
      }
      console.log('Exiting (pass --apply to write).');
      return;
    }

    let linked = 0;
    let skipped = 0;
    let errors = 0;
    let processed = 0;
    for (const p of persons) {
      try {
        const resolved = await entities.resolveSubjectEntityId(p.tenantId, {
          authorPersonId: p.id,
          authorEmail: null,
          speakerParticipantId: null,
          speakerName: null,
          authorUserId: null,
        });
        if (!resolved) {
          skipped++;
        } else {
          await prisma.person.update({
            where: { id: p.id },
            data: { entityId: resolved, entityTenantId: p.tenantId },
          });
          linked++;
        }
      } catch (err) {
        errors++;
        console.warn(
          `[error] personId=${p.id} tenantId=${p.tenantId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      processed++;
      if (processed % 50 === 0) {
        console.log(
          `progress: processed=${processed}/${persons.length}, linked=${linked}, skipped=${skipped}, errors=${errors}`,
        );
      }
    }

    console.log(
      `=== DONE total=${persons.length}, linked=${linked}, skipped=${skipped}, errors=${errors} ===`,
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
    console.error('backfill-knowledge-clone-person-entity FAILED:', err);
    process.exit(1);
  });
