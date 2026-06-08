/**
 * ТЗ-2 Ф2 (daily-value-dashboards) — Seed AdminSetting для новой раскладки
 * COO-дашборда («операционный директор»).
 *
 * Регистрирует kill-switch новой компоновки overview-дашборда (редактируется
 * super_admin'ом в админке, code-fallback `true` в самом сервисе):
 *
 *   - `operations.dashboard_rework.enabled` (bool, default true) — kill-switch.
 *     Едет в overview DTO как `reworkEnabled`; гейтит только инфо-перекомпоновку
 *     на фронте (capacity по командам, «сколько закрыли», хронические блокеры
 *     с «Причиной», приём переносов). Современный визуал — безусловно.
 *     OFF возвращает прежнюю раскладку.
 *
 * Запуск:
 *   bun run scripts/seed-admin-setting-operations-dashboard.ts
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
    key: 'operations.dashboard_rework.enabled',
    value: true,
    category: 'operations',
    section: 'dashboard',
    severity: 'medium',
    description:
      'Kill-switch (ON): новая раскладка COO-дашборда — capacity по командам, «сколько закрыли», хронические блокеры (накопительный синтез) с «Причиной», приём переносов. Едет в overview DTO как reworkEnabled, гейтит инфо-перекомпоновку на фронте; современный визуал — безусловно. OFF возвращает прежнюю раскладку.',
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
  console.log('=== seed-admin-setting-operations-dashboard START ===');

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
  console.log('=== seed-admin-setting-operations-dashboard DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-operations-dashboard FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
