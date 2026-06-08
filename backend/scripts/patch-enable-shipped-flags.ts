/**
 * Ship-On (2026-06-08): включить готовые фичи дефолтом на СУЩЕСТВУЮЩЕМ проде.
 *
 * Контекст:
 *   ТЗ `plans/tz/2026-06-08-enable-shipped-features-by-default.md` Часть A, Ф3.
 *   Несколько готовых AdminSetting-флагов исторически засеяны `false`
 *   («дефолт OFF, включим потом»). Простой правки seed-дефолта на `true`
 *   недостаточно: сидеры идемпотентны/create-only и НЕ перезатирают уже
 *   существующие значения. Этот patch выставляет `true` на проде.
 *
 * Ключи (CLAUDE.md принцип 8 — Ship-On):
 *   - knowledge.meetingTasksToTrackerOnly — единая видимая задача из встречи.
 *   - feature.tables_text_to_schema       — Smart-таблицы по текстовому описанию.
 *   - knowledge.curationAutotuneEnabled   — автоподстройка порогов курации.
 *
 * Уважение admin-override (safe-seed-rules):
 *   - запись отсутствует → пропускаем (seed/код-фоллбэк её покроют; не
 *     выдумываем category/section);
 *   - value === false И updatedBy == null (трогал только seed) → update → true;
 *   - value === true → no-op (already-true);
 *   - updatedBy != null (правил человек) → no-op (уважаем override).
 *
 * Идемпотентность: повторный прогон → всё already-true → 0 updated.
 *
 * Запуск:
 *   docker compose exec backend bun run scripts/patch-enable-shipped-flags.ts
 *
 * Регистрация: backend/scripts/apply-prod-deploy.ts (phase: 'patch', skipBootstrap).
 */

import type { Prisma, PrismaClient } from '@prisma/client';

import { createPrismaClient } from './_lib/prisma';

/** Ключи AdminSetting, которые переводим в `true` (если их трогал только seed). */
const KEYS = [
  'knowledge.meetingTasksToTrackerOnly',
  'feature.tables_text_to_schema',
  'knowledge.curationAutotuneEnabled',
] as const;

/** Снимок существующей записи, нужный для решения. */
export interface ExistingSetting {
  value: Prisma.JsonValue;
  updatedBy: string | null;
}

export type Decision =
  | 'update' // false + не трогал админ → переводим в true
  | 'skip-absent' // записи нет → код/seed-фоллбэк покроет
  | 'skip-already-true' // уже true → no-op
  | 'skip-admin-edited'; // updatedBy != null → уважаем override

/**
 * Чистое решение по одной записи — для unit-теста.
 * `existing === null` означает «записи в БД нет».
 */
export function decide(existing: ExistingSetting | null): Decision {
  if (existing === null) return 'skip-absent';
  if (existing.value === true) return 'skip-already-true';
  if (existing.updatedBy !== null) return 'skip-admin-edited';
  // value !== true И updatedBy == null → включаем (включая false и любое не-true seed-значение).
  if (existing.value === false) return 'update';
  // Защитная ветка: не-boolean seed-значение (не должно случаться для этих
  // ключей) — не трогаем, чтобы не сломать неожиданный тип.
  return 'skip-already-true';
}

export interface Stats {
  updated: number;
  skippedAbsent: number;
  skippedAlreadyTrue: number;
  skippedAdminEdited: number;
}

export async function patchEnableShippedFlags(
  prisma: PrismaClient,
): Promise<Stats> {
  const stats: Stats = {
    updated: 0,
    skippedAbsent: 0,
    skippedAlreadyTrue: 0,
    skippedAdminEdited: 0,
  };

  console.log('=== patch-enable-shipped-flags START ===');

  for (const key of KEYS) {
    const existing = await prisma.adminSetting.findUnique({
      where: { key },
      select: { value: true, updatedBy: true },
    });

    const decision = decide(existing);

    switch (decision) {
      case 'update': {
        await prisma.adminSetting.update({
          where: { key },
          data: { value: true },
        });
        stats.updated++;
        console.log(`  [update] ${key}: false → true`);
        break;
      }
      case 'skip-absent': {
        stats.skippedAbsent++;
        console.log(`  [skip] ${key}: absent (code-fallback покроет)`);
        break;
      }
      case 'skip-already-true': {
        stats.skippedAlreadyTrue++;
        console.log(`  [skip] ${key}: already-true`);
        break;
      }
      case 'skip-admin-edited': {
        stats.skippedAdminEdited++;
        console.log(`  [skip] ${key}: admin-edited (updatedBy != null), уважаем override`);
        break;
      }
    }
  }

  console.log('=== Итоги patch-enable-shipped-flags ===');
  console.log(`  updated            : ${stats.updated}`);
  console.log(`  skipped (absent)   : ${stats.skippedAbsent}`);
  console.log(`  skipped (already)  : ${stats.skippedAlreadyTrue}`);
  console.log(`  skipped (admin-ed) : ${stats.skippedAdminEdited}`);

  return stats;
}

// CLI-враппер.
if (require.main === module) {
  const prisma = createPrismaClient();
  patchEnableShippedFlags(prisma)
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('patch-enable-shipped-flags FAILED:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
