/**
 * Support desk Ф3 (TZ 2026-06-09 support-desk-clone-and-closed-contour) —
 * Seed AdminSetting для порога critic-проверки черновика клона.
 *
 * Регистрирует ключ:
 *   - `support_critic_min_groundedness` (number, default 0.6) — минимальная
 *     обоснованность (groundedness = подтверждённые блоками утверждения /
 *     всего утверждений) черновика клона, ниже которой исход критика —
 *     `clarify`/`escalate`, а не `answer` (R-INV-5).
 *
 * Крутилка идёт в AdminSetting, не в ENV и не в код
 * (feedback_admin_settings_not_env_or_code) — super_admin правит через UI.
 *
 * Запуск:
 *   bun run scripts/seed-admin-setting-support.ts
 *
 * Идемпотентность (skill `safe-seed-rules`):
 *   - Если AdminSetting уже редактировался super_admin'ом (`updatedBy != null`
 *     и `updatedBy != 'system'`) — НЕ перезаписываем `value`, обновляем только
 *     метаданные (category/section/severity/description).
 *   - Системная запись — обновим value на текущий fallback.
 *   - Двойной запуск = no-op.
 */

import { type Prisma } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

type Severity = 'low' | 'medium' | 'high' | 'destructive';

interface SettingSeed {
  key: string;
  value: unknown;
  category: string;
  section: string;
  severity: Severity;
  description: string;
}

const SEEDS: SettingSeed[] = [
  {
    key: 'support_critic_min_groundedness',
    value: 0.6,
    category: 'support',
    section: 'critic',
    severity: 'medium',
    description:
      'Минимальная обоснованность (groundedness) черновика клона поддержки, ниже которой исход критика — clarify/escalate, а не answer (R-INV-5). 0..1.',
  },
];

interface Counters {
  created: number;
  updated: number;
  skippedAdminEdited: number;
}

async function upsertSetting(
  seed: SettingSeed,
  counters: Counters,
): Promise<void> {
  const existing = await prisma.adminSetting.findUnique({
    where: { key: seed.key },
    select: { updatedBy: true },
  });
  const valueInput = seed.value as Prisma.InputJsonValue;

  if (!existing) {
    await prisma.adminSetting.create({
      data: {
        key: seed.key,
        value: valueInput,
        category: seed.category,
        section: seed.section,
        severity: seed.severity,
        description: seed.description,
      },
    });
    counters.created++;

    console.log(`[create] ${seed.key}`);
    return;
  }

  // Admin-edited — не трогаем value, обновляем только метаданные.
  if (existing.updatedBy && existing.updatedBy !== 'system') {
    await prisma.adminSetting.update({
      where: { key: seed.key },
      data: {
        category: seed.category,
        section: seed.section,
        severity: seed.severity,
        description: seed.description,
      },
    });
    counters.skippedAdminEdited++;

    console.log(`[skip:admin-edited] ${seed.key}`);
    return;
  }

  await prisma.adminSetting.update({
    where: { key: seed.key },
    data: {
      value: valueInput,
      category: seed.category,
      section: seed.section,
      severity: seed.severity,
      description: seed.description,
    },
  });
  counters.updated++;

  console.log(`[update] ${seed.key}`);
}

async function main(): Promise<void> {
  console.log('=== seed-admin-setting-support START ===');

  const counters: Counters = {
    created: 0,
    updated: 0,
    skippedAdminEdited: 0,
  };

  for (const seed of SEEDS) {
    await upsertSetting(seed, counters);
  }

  console.log(
    `created=${counters.created}, updated=${counters.updated}, skipped_admin_edited=${counters.skippedAdminEdited}`,
  );

  console.log('=== seed-admin-setting-support DONE ===');
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('seed-admin-setting-support FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
