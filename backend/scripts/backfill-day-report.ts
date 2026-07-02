import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { DayReportCollectorService } from '../src/modules/operations/services/day-report-collector.service';
import { getLocalDate } from '../src/modules/operations/utils/local-date';

import { silenceRedisShutdownNoise } from './_lib/silence-redis-shutdown';

const TIMEZONE = 'Europe/Moscow' as const;
const DEFAULT_DAYS = 30;

interface Options {
  days: number;
  tenantId?: string;
}

interface Stats {
  orgDays: number;
  persons: number;
  morningUpserts: number;
  eveningUpserts: number;
  errors: number;
}

function parseArgs(argv: string[]): Options {
  const tenantArg = argv.find((a) => a.startsWith('--tenant='));
  const daysArg = argv.find((a) => a === '--days' || a.startsWith('--days='));

  let days = DEFAULT_DAYS;
  if (daysArg) {
    let v: string | undefined;
    if (daysArg.includes('=')) {
      v = daysArg.split('=')[1];
    } else {
      const idx = argv.indexOf('--days');
      v = argv[idx + 1];
    }
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`Некорректное значение --days: "${v ?? ''}" (ожидалось положительное целое)`);
    }
    days = n;
  }

  const opts: Options = { days };
  if (tenantArg) {
    const v = tenantArg.split('=')[1];
    if (v) opts.tenantId = v;
  }
  return opts;
}

async function main(opts: Options): Promise<void> {
  console.log(
    `=== backfill-day-report СТАРТ (days=${opts.days}, tenant=${opts.tenantId ?? '<все>'}) ===`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const stats: Stats = { orgDays: 0, persons: 0, morningUpserts: 0, eveningUpserts: 0, errors: 0 };

  try {
    const prisma = app.get(PrismaService);
    const collector = app.get(DayReportCollectorService);

    const orgs = await prisma.org.findMany({
      where: { deletedAt: null, ...(opts.tenantId ? { id: opts.tenantId } : {}) },
      select: { id: true },
    });
    console.log(`backfill-day-report: организаций к обработке ${orgs.length}, дней ${opts.days}`);

    for (let d = 1; d <= opts.days; d++) {
      const dateLocal = getLocalDate(new Date(Date.now() - d * 24 * 3600 * 1000), TIMEZONE);
      for (const org of orgs) {
        try {
          const res = await collector.assembleAndUpsert({ tenantId: org.id, dateLocal });
          stats.orgDays += 1;
          stats.persons += res.persons;
          stats.morningUpserts += res.morningUpserts;
          stats.eveningUpserts += res.eveningUpserts;
        } catch (err) {
          stats.errors += 1;
          console.warn(
            `[ошибка] org=${org.id} день=${dateLocal}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      console.log(`backfill-day-report: день ${d}/${opts.days} (${dateLocal}) обработан`);
    }

    console.log('=== Итоги backfill-day-report ===');
    console.log(`  обработано org×день : ${stats.orgDays}`);
    console.log(`  людей (суммарно)    : ${stats.persons}`);
    console.log(`  morning upserts     : ${stats.morningUpserts}`);
    console.log(`  evening upserts     : ${stats.eveningUpserts}`);
    console.log(`  ошибок              : ${stats.errors}`);
  } finally {
    await app.close();
  }
}

const opts = parseArgs(process.argv.slice(2));
silenceRedisShutdownNoise();
main(opts)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('backfill-day-report ПРОВАЛЕН:', err);
    process.exit(1);
  });
