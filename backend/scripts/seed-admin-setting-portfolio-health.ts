/**
 * ТЗ-2 Ф6.A (daily-value-dashboards) — Seed AdminSetting для здоровья портфеля
 * целей.
 *
 * Регистрирует ключи динамической конфигурации:
 *   - `portfolio.health.threshold_healthy` (int, default 60) — порог «здоров».
 *   - `portfolio.health.threshold_warning` (int, default 40) — порог «внимание».
 *   - `portfolio.health.weight_achieved` (int 0..100, default 100) — балл статуса achieved.
 *   - `portfolio.health.weight_on_track` (int 0..100, default 80) — балл on_track.
 *   - `portfolio.health.weight_at_risk` (int 0..100, default 40) — балл at_risk.
 *   - `portfolio.health.weight_stalled` (int 0..100, default 0) — балл stalled.
 *   - `portfolio.health.weight_dropped` (int 0..100, default 0) — балл dropped.
 *   - `operations.portfolio_health.enabled` (boolean, default true) —
 *     kill-switch недельного снимка портфеля + эндпоинта. ON (Ship-On).
 *
 * Веса заданы в шкале 0..100 (баллы статуса); формула здоровья считает
 * взвешенное среднее баллов по живым целям (см. portfolio-health.scoring.ts).
 *
 * Запуск:
 *   bun run scripts/seed-admin-setting-portfolio-health.ts
 *
 * Идемпотентность (skill `safe-seed-rules`):
 *   - Если AdminSetting уже редактировался super_admin'ом (`updatedBy != null`
 *     и `updatedBy != 'system'`) — НЕ перезаписываем `value`, обновляем только
 *     метаданные (category/section/severity/description).
 *   - Системная запись — обновим value на текущий fallback.
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
    key: 'portfolio.health.threshold_healthy',
    value: 60,
    category: 'operations',
    section: 'portfolio_health',
    severity: 'low',
    description:
      'Порог балла здоровья портфеля, с которого портфель «здоров» (level=healthy). По умолчанию 60.',
  },
  {
    key: 'portfolio.health.threshold_warning',
    value: 40,
    category: 'operations',
    section: 'portfolio_health',
    severity: 'low',
    description:
      'Порог балла здоровья портфеля, с которого «внимание» (level=warning), ниже — «критично». По умолчанию 40.',
  },
  {
    key: 'portfolio.health.weight_achieved',
    value: 100,
    category: 'operations',
    section: 'portfolio_health',
    severity: 'medium',
    description:
      'Балл статуса «достигнуто» в здоровье портфеля (шкала 0..100). По умолчанию 100.',
  },
  {
    key: 'portfolio.health.weight_on_track',
    value: 80,
    category: 'operations',
    section: 'portfolio_health',
    severity: 'medium',
    description:
      'Балл статуса «в графике» в здоровье портфеля (шкала 0..100). По умолчанию 80.',
  },
  {
    key: 'portfolio.health.weight_at_risk',
    value: 40,
    category: 'operations',
    section: 'portfolio_health',
    severity: 'medium',
    description:
      'Балл статуса «под риском» в здоровье портфеля (шкала 0..100). По умолчанию 40.',
  },
  {
    key: 'portfolio.health.weight_stalled',
    value: 0,
    category: 'operations',
    section: 'portfolio_health',
    severity: 'medium',
    description:
      'Балл статуса «застряло» в здоровье портфеля (шкала 0..100). По умолчанию 0.',
  },
  {
    key: 'portfolio.health.weight_dropped',
    value: 0,
    category: 'operations',
    section: 'portfolio_health',
    severity: 'low',
    description:
      'Балл статуса «брошено» в здоровье портфеля (шкала 0..100). По умолчанию 0.',
  },
  {
    key: 'operations.portfolio_health.enabled',
    value: true,
    category: 'operations',
    section: 'portfolio_health',
    severity: 'medium',
    description:
      'Kill-switch здоровья портфеля целей (weekly cron понедельник 05:00 + COO-эндпоинт). true (Ship-On).',
  },
];

interface Counters {
  created: number;
  updated: number;
  skippedAdminEdited: number;
}

async function upsertSetting(seed: SettingSeed, counters: Counters): Promise<void> {
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
  console.log('=== seed-admin-setting-portfolio-health START ===');

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
  console.log('=== seed-admin-setting-portfolio-health DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-portfolio-health FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
