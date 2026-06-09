/**
 * ТЗ-2 Ф4 (daily-value-dashboards) — Seed AdminSetting для self-view
 * недельного план-факта по людям (`GET /api/v1/me/weekly-per-person`).
 *
 * Регистрирует kill-switch self-view'а (редактируется super_admin'ом в админке,
 * code-fallback `true` в самом контроллере):
 *
 *   - `operations.per_person_self_view.enabled` (bool, default true) —
 *     kill-switch (ON). Гейтит ТОЛЬКО self-эндпоинт `/me/weekly-per-person`:
 *     любой пользователь с Person видит свою строку недельного план-факта +
 *     среднюю надёжность команды. OFF → эндпоинт отдаёт пустой self DTO
 *     (graceful 200). На COO-дашборд (RBAC-эндпоинт) не влияет.
 *
 * Запуск:
 *   bun run scripts/seed-admin-setting-operations-per-person.ts
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
    key: 'operations.per_person_self_view.enabled',
    value: true,
    category: 'operations',
    section: 'per_person',
    severity: 'medium',
    description:
      'Kill-switch (ON): self-view недельного план-факта /me/weekly-per-person — любой пользователь с Person видит свою строку (обещания/задачи/чек-ины) + среднюю надёжность команды (стрелка «я vs команда»). OFF → эндпоинт отдаёт пустой self DTO (graceful). На COO-дашборд (RBAC) не влияет.',
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
  console.log('=== seed-admin-setting-operations-per-person START ===');

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
  console.log('=== seed-admin-setting-operations-per-person DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-operations-per-person FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
