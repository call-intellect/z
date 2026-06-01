/**
 * SBA β-8.2 — Backfill `commitmentStatus` и `commitmentDueDate` для уже
 * существующих IdeaBlock'ов с signalType='commitment', у которых эти поля
 * ещё не заполнены.
 *
 * Логика:
 *   - Все блоки signalType='commitment' и commitmentStatus IS NULL:
 *     - commitmentStatus = 'open'
 *     - commitmentDueDate = nextBusinessDay(createdAt + COMMITMENT_FALLBACK_DUE_WORKDAYS)
 *       рабочих дней через HolidayService (учёт праздников/выходных).
 *
 * Запуск (разовый, после деплоя β-8.2):
 *   bun run scripts/backfill-commitment-due-dates.ts --dry-run
 *   bun run scripts/backfill-commitment-due-dates.ts
 *
 * Идемпотентность: повторный запуск пропустит уже обработанные (commitmentStatus
 * IS NOT NULL).
 */

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { TypedConfigService } from '../src/common/config/index';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { HolidayService } from '../src/modules/tracker/services/holiday.service';

import { createPrismaClient } from './_lib/prisma';

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
  // Лёгкий pre-check ДО подъёма всего AppModule (Nest DI + HolidayService +
  // конфиг): если бэкфилить нечего — выходим чисто, не поднимая тяжёлый
  // контекст и не рискуя упасть на bootstrap при неготовой инфраструктуре.
  const preCheck = createPrismaClient();
  try {
    const pending = await preCheck.ideaBlock.count({
      where: { signalType: 'commitment', commitmentStatus: null },
    });
    if (pending === 0) {
      // eslint-disable-next-line no-console
      console.log(
        'backfill-commitment-due-dates: нет commitment-блоков без статуса — обновление не требуется, данные актуальны.',
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

    let cursor: string | undefined;
    const pageSize = 500;
    while (true) {
      const blocks = await prisma.ideaBlock.findMany({
        where: {
          signalType: 'commitment',
          commitmentStatus: null,
        },
        select: { id: true, tenantId: true, createdAt: true },
        orderBy: { id: 'asc' },
        take: pageSize,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
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
              where: { id: block.id },
              data: {
                commitmentStatus: 'open',
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
      cursor = blocks[blocks.length - 1]?.id;
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

/**
 * Сдвинуть дату вперёд на N рабочих дней через HolidayService. Считаем
 * последовательно: каждый раз berëм nextBusinessDay(date + 1) и
 * уменьшаем счётчик.
 */
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
main({ dryRun })
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('backfill-commitment-due-dates FAILED:', err);
    process.exit(1);
  });
