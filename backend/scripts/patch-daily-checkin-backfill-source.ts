/**
 * ТЗ 2026-05-29 telegram-self-initiated-checkins — Фаза 3.
 *
 * Backfill поля `source` в таблице `daily_check_ins`:
 *   - после `prisma:push` все существующие записи получили default
 *     `source='cron_prompted'`.
 *   - но записи, созданные через `POST /me/check-ins` (manual create через
 *     web-UI), не привязаны к notification — у них `notificationId IS NULL`.
 *     Их перевешиваем в `source='manual'`.
 *
 * Логика:
 *   UPDATE daily_check_ins
 *      SET source = 'manual'
 *    WHERE notificationId IS NULL
 *      AND source = 'cron_prompted';
 *
 * Идемпотентен: повторный запуск ничего не делает (после первого прогона
 * matching-строк нет — source уже 'manual').
 *
 * Запуск:
 *   docker compose exec backend bun run scripts/patch-daily-checkin-backfill-source.ts
 *   docker compose exec backend bun run scripts/patch-daily-checkin-backfill-source.ts --dry-run
 *
 * Зарегистрирован в `apply-prod-deploy.ts` STEPS (phase: 'patch', skipBootstrap: true).
 */

import { createPrismaClient } from './_lib/prisma';

interface CliOptions {
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { dryRun: false };
  for (const arg of argv) {
    if (arg === '--dry-run') opts.dryRun = true;
  }
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const prisma = createPrismaClient();
  // eslint-disable-next-line no-console
  console.log('[patch-daily-checkin-backfill-source] start', {
    dryRun: opts.dryRun,
  });

  try {
    const candidatesCount = await prisma.dailyCheckIn.count({
      where: { notificationId: null, source: 'cron_prompted' },
    });
    // eslint-disable-next-line no-console
    console.log(
      `[patch-daily-checkin-backfill-source] candidates: ${candidatesCount}`,
    );

    if (opts.dryRun) {
      // eslint-disable-next-line no-console
      console.log('[patch-daily-checkin-backfill-source] dry-run — skipping update');
      return;
    }

    const result = await prisma.dailyCheckIn.updateMany({
      where: { notificationId: null, source: 'cron_prompted' },
      data: { source: 'manual' },
    });
    // eslint-disable-next-line no-console
    console.log(
      `[patch-daily-checkin-backfill-source] updated: ${result.count}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[patch-daily-checkin-backfill-source] ERROR', err);
  process.exit(1);
});
