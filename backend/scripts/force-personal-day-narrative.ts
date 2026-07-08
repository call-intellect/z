import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PersonalDayNarrativeService } from '../src/modules/operations/services/personal-day-narrative.service';
import { yesterdayLocalDate } from '../src/modules/operations/utils/local-date';

import { silenceRedisShutdownNoise } from './_lib/silence-redis-shutdown';

interface Options {
  date: string;
  tenantId?: string;
  personId?: string;
  all: boolean;
  force: boolean;
}

function parseArgs(argv: string[]): Options {
  const get = (prefix: string): string | undefined => {
    const arg = argv.find((a) => a.startsWith(prefix));
    if (!arg) return undefined;
    const v = arg.slice(prefix.length);
    return v.length > 0 ? v : undefined;
  };
  const date = get('--date=') ?? yesterdayLocalDate(new Date(), 'Europe/Moscow');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid --date value: "${date}" (expected YYYY-MM-DD)`);
  }
  return {
    date,
    tenantId: get('--tenant='),
    personId: get('--person='),
    all: argv.includes('--all'),
    force: argv.includes('--force'),
  };
}

async function main(opts: Options): Promise<void> {
  if (!opts.tenantId && !opts.personId && !opts.all) {
    console.error(
      'force-personal-day-narrative: укажи --tenant=<orgId>, --person=<personId> или --all (все сотрудники всех оргов).',
    );
    process.exit(1);
  }

  const packageRef = new Date(`${opts.date}T12:00:00.000Z`);
  console.log(
    `=== force-personal-day-narrative START ` +
      `(date=${opts.date}, tenant=${opts.tenantId ?? '<all>'}, ` +
      `person=${opts.personId ?? '<all>'}, force=${opts.force}) ===`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  let generated = 0;
  let errors = 0;
  try {
    const prisma = app.get(PrismaService);
    const service = app.get(PersonalDayNarrativeService);

    const persons = await prisma.person.findMany({
      where: {
        deletedAt: null,
        relationship: 'employee',
        userId: { not: null },
        ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
        ...(opts.personId ? { id: opts.personId } : {}),
      },
      select: { id: true, tenantId: true, userId: true, name: true, timezone: true },
      take: 5_000,
    });
    console.log(`force-personal-day-narrative: сотрудников в скоупе ${persons.length}`);

    for (const p of persons) {
      const now = new Date();
      const person = { id: p.id, userId: p.userId, name: p.name, timezone: p.timezone };
      try {
        const dto = opts.force
          ? await service.generate({ tenantId: p.tenantId, person, now, packageRef })
          : await service.getOrGenerate({ tenantId: p.tenantId, person, now, packageRef });
        generated++;
        console.log(JSON.stringify({ personId: p.id, dateLocal: dto.dateLocal, ok: true }));
      } catch (err) {
        errors++;
        console.log(
          JSON.stringify({
            personId: p.id,
            err: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }

    console.log(
      `=== Итоги force-personal-day-narrative: ` +
        `generated=${generated}, errors=${errors}, total=${persons.length} ===`,
    );
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  silenceRedisShutdownNoise();
  main(opts)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('force-personal-day-narrative FAILED:', err);
      process.exit(1);
    });
}

export { main };
