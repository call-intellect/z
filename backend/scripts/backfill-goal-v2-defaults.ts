/**
 * Backfill Goals OKR v2 defaults (2026-06-02).
 *
 * Контекст:
 *   ТЗ `plans/tz/2026-06-02-goals-okr-v2.md` (Фаза 0) расширяет модель `Goal`
 *   полями с `@default(...)`: `source='manual'`, `promotionState='active'`,
 *   `progressStatus='on_track'`, `recordedAt=now()`.
 *
 *   Колонки с `@default(...)` Postgres проставит существующим строкам сам при
 *   `prisma db push`. ЕДИНСТВЕННАЯ реальная работа этого backfill — поправить
 *   `recordedAt`: push выставит legacy-целям `recordedAt = now()`, что неверно
 *   (bitemporal `recordedAt` должен совпадать с `createdAt` для исторических
 *   целей). Здесь выставляем `recordedAt = createdAt`.
 *
 * Идемпотентность:
 *   Обновляем только живые версии целей с расхождением:
 *     `validUntil IS NULL AND supersededById IS NULL AND recordedAt <> createdAt`.
 *   Второй прогон → 0 обновлений (recordedAt уже совпадает).
 *
 * Запуск:
 *   docker compose exec backend bun run scripts/backfill-goal-v2-defaults.ts          # dry-run
 *   docker compose exec backend bun run scripts/backfill-goal-v2-defaults.ts --apply   # запись
 *
 * Регистрация: backend/scripts/apply-prod-deploy.ts (phase: 'backfill').
 */

import type { PrismaClient } from '@prisma/client';

import { createPrismaClient } from './_lib/prisma';

export interface Stats {
  goalsScanned: number;
  recordedAtFixed: number;
}

const BATCH_SIZE = 200;

/**
 * Чистая функция backfill — для импорта в unit-тесте (мок-PrismaClient).
 * При `apply=false` (dry-run) считает кандидатов, но ничего не пишет.
 */
export async function backfillGoalV2Defaults(
  prisma: PrismaClient,
  opts: { apply: boolean },
): Promise<Stats> {
  const stats: Stats = { goalsScanned: 0, recordedAtFixed: 0 };

  console.log(
    `=== backfill-goal-v2-defaults START (apply=${opts.apply}, batch=${BATCH_SIZE}) ===`,
  );

  // Курсорная пагинация по живым версиям целей, у которых recordedAt разъехался
  // с createdAt (legacy-цели, получившие recordedAt=now() при push).
  let cursorId: string | undefined = undefined;
  while (true) {
    const batch: { id: string; createdAt: Date }[] = await prisma.goal.findMany({
      where: {
        validUntil: null,
        supersededById: null,
        // recordedAt != createdAt — raw-фильтр через сравнение колонок не
        // выражается в Prisma where, поэтому отбираем кандидатов и сверяем в JS.
      },
      select: { id: true, createdAt: true, recordedAt: true },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
    }) as unknown as { id: string; createdAt: Date; recordedAt: Date }[];

    if (batch.length === 0) break;

    for (const goal of batch as { id: string; createdAt: Date; recordedAt: Date }[]) {
      stats.goalsScanned++;
      // Сравниваем по миллисекундам — recordedAt совпадает с createdAt → пропуск.
      if (goal.createdAt.getTime() === goal.recordedAt.getTime()) continue;

      if (opts.apply) {
        await prisma.goal.update({
          where: { id: goal.id },
          data: { recordedAt: goal.createdAt },
        });
      } else {
        console.log(
          `[DRY-RUN] would set recordedAt=${goal.createdAt.toISOString()} for goal ${goal.id}`,
        );
      }
      stats.recordedAtFixed++;
    }

    cursorId = batch[batch.length - 1]?.id;
    if (batch.length < BATCH_SIZE) break;
  }

  console.log('=== Итоги backfill-goal-v2-defaults ===');
  console.log(`  goalsScanned     : ${stats.goalsScanned}`);
  console.log(`  recordedAtFixed  : ${stats.recordedAtFixed}`);
  console.log(`  mode             : ${opts.apply ? 'APPLY' : 'DRY-RUN'}`);

  return stats;
}

// CLI-враппер.
if (require.main === module) {
  const apply = process.argv.includes('--apply');
  const prisma = createPrismaClient();
  backfillGoalV2Defaults(prisma, { apply })
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('backfill-goal-v2-defaults FAILED:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
