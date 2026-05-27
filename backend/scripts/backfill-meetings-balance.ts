/**
 * Backfill (ТЗ 2026-05-27 billing) Фаза 3 — стартовый грант MeetingsBalance.
 *
 * Для каждой Org, у которой ещё нет записи MeetingsBalance, создаёт
 * запись с balance=150 (= calculateMeetingsGrant(seatsExtra=0), базовый
 * тариф tier_standard). Эта операция нужна на ОДИН раз при выкатке Фазы 3,
 * потому что старая квота `meetings_per_month` ушла, а MeetingsBalance ещё
 * пуст у всех existing Org.
 *
 * Идемпотентность: where: { meetingsBalance: null } — повторный запуск
 * не меняет уже наполненные балансы.
 *
 * Запуск:
 *   bun run scripts/backfill-meetings-balance.ts          — реальный backfill
 *   bun run scripts/backfill-meetings-balance.ts --dry-run — только подсчёт
 *
 * Через docker compose (prod):
 *   docker compose exec backend bun run scripts/backfill-meetings-balance.ts
 */

import { createPrismaClient } from './_lib/prisma';

const DRY_RUN = process.argv.includes('--dry-run');

/** Соответствует MeetingsBalanceService.BASE_MEETINGS_GRANT. Не импортирую
 *  оттуда, чтобы скрипт не зависел от NestJS-DI. */
const STARTING_BALANCE = 150;

const BATCH_SIZE = 500;

interface Counters {
  scanned: number;
  granted: number;
}

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  const counters: Counters = { scanned: 0, granted: 0 };

  // eslint-disable-next-line no-console
  console.log(
    `=== backfill-meetings-balance START (dryRun=${DRY_RUN}, balance=${STARTING_BALANCE}) ===`,
  );

  try {
    while (true) {
      const batch = await prisma.org.findMany({
        where: {
          deletedAt: null,
          meetingsBalance: null,
        },
        select: { id: true },
        take: BATCH_SIZE,
      });

      if (batch.length === 0) break;
      counters.scanned += batch.length;

      if (DRY_RUN) {
        for (const row of batch) {
          // eslint-disable-next-line no-console
          console.log(`  org=${row.id}  → balance=${STARTING_BALANCE}  [dry-run]`);
        }
        // В dry-run эту партию не «съели» — выходим, чтобы не зациклиться.
        break;
      }

      const now = new Date();
      await prisma.$transaction(
        batch.map((row) =>
          prisma.meetingsBalance.create({
            data: {
              tenantId: row.id,
              balance: STARTING_BALANCE,
              totalGranted: STARTING_BALANCE,
              lastGrantedAt: now,
            },
          }),
        ),
      );
      counters.granted += batch.length;

      // eslint-disable-next-line no-console
      console.log(`  granted: ${counters.granted} (текущий batch=${batch.length})`);
    }
  } finally {
    await prisma.$disconnect();
  }

  // eslint-disable-next-line no-console
  console.log(
    `=== backfill-meetings-balance DONE ===\n` +
      `  scanned: ${counters.scanned}\n` +
      `  granted: ${counters.granted}\n` +
      `  dryRun: ${DRY_RUN}`,
  );
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('FATAL', err);
  process.exit(1);
});
