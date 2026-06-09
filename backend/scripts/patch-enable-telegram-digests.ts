/**
 * TZ-1 Фаза 0 (daily-value-engine) — включить доставку дайджестов в Telegram.
 *
 * Контекст (LOCKED DECISION 1): владелец авторизовал доставку в Telegram для
 * батча daily-value (2026-06-08). Переводим в `true` два существующих флага,
 * которые исторически засеяны `false` («дефолт OFF, включим потом»):
 *   - operations.daily_digest.deliver_to_telegram — ежедневный отчёт COO в ТГ.
 *   - goals.pulse.deliver_to_telegram             — еженедельный пульс целей в ТГ.
 *
 * Cron-код НЕ меняем — он читает эти AdminSetting через getDynamic; достаточно
 * флипнуть значение.
 *
 * Уважение admin-override (safe-seed-rules):
 *   - запись отсутствует → пропускаем (seed её покроет);
 *   - value === true → no-op (already-true);
 *   - updatedBy != null И != 'system' (правил человек) → no-op (уважаем override);
 *   - иначе → update → true.
 *
 * Идемпотентность: повторный прогон → всё already-true → 0 updated.
 *
 * Запуск:
 *   docker compose exec backend bun run scripts/patch-enable-telegram-digests.ts
 *
 * Регистрация: backend/scripts/apply-prod-deploy.ts (phase: 'patch', skipBootstrap).
 */

import type { Prisma, PrismaClient } from '@prisma/client';

import { createPrismaClient } from './_lib/prisma';

const KEYS = [
  'operations.daily_digest.deliver_to_telegram',
  'goals.pulse.deliver_to_telegram',
] as const;

export interface ExistingSetting {
  value: Prisma.JsonValue;
  updatedBy: string | null;
}

export type Decision =
  | 'update'
  | 'skip-absent'
  | 'skip-already-true'
  | 'skip-admin-edited';

/** Чистое решение по одной записи — для unit-теста. */
export function decide(existing: ExistingSetting | null): Decision {
  if (existing === null) return 'skip-absent';
  if (existing.value === true) return 'skip-already-true';
  // updatedBy != null И != 'system' → правил человек, уважаем override.
  if (existing.updatedBy !== null && existing.updatedBy !== 'system') {
    return 'skip-admin-edited';
  }
  return 'update';
}

export interface Stats {
  updated: number;
  skippedAbsent: number;
  skippedAlreadyTrue: number;
  skippedAdminEdited: number;
}

export async function patchEnableTelegramDigests(
  prisma: PrismaClient,
): Promise<Stats> {
  const stats: Stats = {
    updated: 0,
    skippedAbsent: 0,
    skippedAlreadyTrue: 0,
    skippedAdminEdited: 0,
  };

  console.log('=== patch-enable-telegram-digests START ===');

  for (const key of KEYS) {
    const existing = await prisma.adminSetting.findUnique({
      where: { key },
      select: { value: true, updatedBy: true },
    });

    const decision = decide(existing);
    switch (decision) {
      case 'update':
        await prisma.adminSetting.update({
          where: { key },
          data: { value: true },
        });
        stats.updated++;
        console.log(`  [update] ${key}: → true`);
        break;
      case 'skip-absent':
        stats.skippedAbsent++;
        console.log(`  [skip] ${key}: absent (seed покроет)`);
        break;
      case 'skip-already-true':
        stats.skippedAlreadyTrue++;
        console.log(`  [skip] ${key}: already-true`);
        break;
      case 'skip-admin-edited':
        stats.skippedAdminEdited++;
        console.log(`  [skip] ${key}: admin-edited, уважаем override`);
        break;
    }
  }

  console.log('=== Итоги patch-enable-telegram-digests ===');
  console.log(`  updated            : ${stats.updated}`);
  console.log(`  skipped (absent)   : ${stats.skippedAbsent}`);
  console.log(`  skipped (already)  : ${stats.skippedAlreadyTrue}`);
  console.log(`  skipped (admin-ed) : ${stats.skippedAdminEdited}`);

  return stats;
}

if (require.main === module) {
  const prisma = createPrismaClient();
  patchEnableTelegramDigests(prisma)
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('patch-enable-telegram-digests FAILED:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
