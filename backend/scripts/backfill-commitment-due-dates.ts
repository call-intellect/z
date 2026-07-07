import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { TypedConfigService } from '../src/common/config/index';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { HolidayService } from '../src/modules/tracker/services/holiday.service';

import { createPrismaClient } from './_lib/prisma';
import { silenceRedisShutdownNoise } from './_lib/silence-redis-shutdown';

interface RunArgs {
  dryRun: boolean;
}

interface Stats {
  scanned: number;
  updated: number;
  skipped: number;
  errors: number;
}

async function main(args: RunArgs): Promise<void> {
  const preCheck = createPrismaClient();
  try {
    const pending = await preCheck.ideaBlock.count({
      where: { signalType: 'commitment', commitmentDueDate: null },
    });
    if (pending === 0) {
      // eslint-disable-next-line no-console
      console.log(
        'backfill-commitment-due-dates: нет commitment-блоков без срока — обновление не требуется, данные актуальны.',
      );
      return;
    }
    // eslint-disable-next-line no-console
    console.log(`backfill-commitment-due-dates: к обработке ${pending} блоков`);
  } finally {
    await preCheck.$disconnect();
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const prisma = app.get(PrismaService);
    const cfg = app.get(TypedConfigService);
    const holidays = app.get(HolidayService);

    const workdays = cfg.betaOps.commitmentFallbackDueWorkdays;
    const stats: Stats = { scanned: 0, updated: 0, skipped: 0, errors: 0 };

    // eslint-disable-next-line no-console
    console.log(
      `=== backfill-commitment-due-dates START (dryRun=${args.dryRun}, workdays=${workdays}) ===`,
    );

    let cursor: { id: string; tenantId: string } | undefined;
    const pageSize = 500;
    while (true) {
      const blocks = await prisma.ideaBlock.findMany({
        where: {
          signalType: 'commitment',
          commitmentDueDate: null,
        },
        select: { id: true, tenantId: true, createdAt: true },
        orderBy: { id: 'asc' },
        take: pageSize,
        ...(cursor
          ? { skip: 1, cursor: { id_tenantId: { id: cursor.id, tenantId: cursor.tenantId } } }
          : {}),
      });
      if (blocks.length === 0) break;

      for (const block of blocks) {
        stats.scanned++;
        try {
          const target = await addWorkdays(holidays, {
            tenantId: block.tenantId,
            startDate: block.createdAt,
            workdays,
          });
          if (!args.dryRun) {
            await prisma.ideaBlock.update({
              where: { id_tenantId: { id: block.id, tenantId: block.tenantId } },
              data: {
                commitmentDueDate: target,
              },
            });
          }
          stats.updated++;
        } catch (err) {
          stats.errors++;
          // eslint-disable-next-line no-console
          console.warn(
            `[error] blockId=${block.id} tenantId=${block.tenantId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      const last = blocks[blocks.length - 1];
      cursor = last ? { id: last.id, tenantId: last.tenantId } : cursor;
      // eslint-disable-next-line no-console
      console.log(
        `progress: scanned=${stats.scanned}, updated=${stats.updated}, errors=${stats.errors}`,
      );
    }

    // eslint-disable-next-line no-console
    console.log(
      `=== DONE scanned=${stats.scanned}, updated=${stats.updated}, skipped=${stats.skipped}, errors=${stats.errors} ===`,
    );
  } finally {
    await app.close();
  }
}

async function addWorkdays(
  holidays: HolidayService,
  args: { tenantId: string; startDate: Date; workdays: number },
): Promise<Date> {
  let current = new Date(
    Date.UTC(
      args.startDate.getUTCFullYear(),
      args.startDate.getUTCMonth(),
      args.startDate.getUTCDate(),
      0,
      0,
      0,
      0,
    ),
  );
  let left = args.workdays;
  while (left > 0) {
    const next = new Date(current.getTime());
    next.setUTCDate(next.getUTCDate() + 1);
    current = await holidays.nextBusinessDay({
      tenantId: args.tenantId,
      date: next,
    });
    left -= 1;
  }
  return current;
}

const dryRun = process.argv.includes('--dry-run');
silenceRedisShutdownNoise();
main({ dryRun })
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('backfill-commitment-due-dates FAILED:', err);
    process.exit(1);
  });
