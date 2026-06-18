/**
 * ТЗ 2026-06-18 (assistant-calendar-master) Ф4 — Seed AdminSetting для дефолтов
 * рабочего профиля человека.
 *
 * Регистрирует ключи динамической конфигурации (читаются через
 * `TypedConfigService.getDynamic`, code-fallback в MeService.workProfileDefaults):
 *   - `work_hours_default_start` (int, default 9)  — час начала рабочего дня 0..23.
 *   - `work_hours_default_end`   (int, default 18) — час конца рабочего дня 0..23.
 *   - `work_days_default`        (int[], default [1,2,3,4,5]) — рабочие дни (0=вс..6=сб).
 *   - `default_timezone`         (string, default 'Europe/Moscow') — таймзона по умолчанию.
 *
 * Применяются, когда у Person личные поля (timezone/workStartHour/workEndHour/
 * workingDays) пусты. Используются расчётом «сегодня/рабочее время» и
 * find_free_slot.
 *
 * Запуск:
 *   bun run scripts/seed-admin-setting-work-hours.ts
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
    key: 'work_hours_default_start',
    value: 9,
    category: 'calendar',
    section: 'work_hours',
    severity: 'low',
    description:
      'Час начала рабочего дня по умолчанию (0..23). Применяется, если у сотрудника не задан личный рабочий профиль. По умолчанию 9.',
  },
  {
    key: 'work_hours_default_end',
    value: 18,
    category: 'calendar',
    section: 'work_hours',
    severity: 'low',
    description:
      'Час конца рабочего дня по умолчанию (0..23). Применяется, если у сотрудника не задан личный рабочий профиль. По умолчанию 18.',
  },
  {
    key: 'work_days_default',
    value: [1, 2, 3, 4, 5],
    category: 'calendar',
    section: 'work_hours',
    severity: 'low',
    description:
      'Рабочие дни недели по умолчанию (0=вс, 1=пн … 6=сб). Применяются, если у сотрудника не задан личный рабочий профиль. По умолчанию Пн–Пт.',
  },
  {
    key: 'default_timezone',
    value: 'Europe/Moscow',
    category: 'calendar',
    section: 'work_hours',
    severity: 'low',
    description:
      'Таймзона по умолчанию (IANA). Применяется, если не задана ни у сотрудника, ни у организации. По умолчанию Europe/Moscow.',
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
  console.log('=== seed-admin-setting-work-hours START ===');

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
  console.log('=== seed-admin-setting-work-hours DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-work-hours FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
