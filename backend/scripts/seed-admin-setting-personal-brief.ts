/**
 * TZ-1 Фаза 2 (daily-value-engine) — Seed AdminSetting для движка рядового
 * «Твой день» + помощник «кто знает X».
 *
 * Регистрирует ключи динамической конфигурации:
 *   - `operations.personal_daily_brief.enabled` (boolean, default true) —
 *     kill-switch дневного брифа. ON (Ship-On).
 *   - `operations.personal_daily_brief.morning_hour` (int, default 9) — локальный
 *     час утреннего окна (по Person.timezone), когда строится/шлётся бриф.
 *   - `operations.knows_who.enabled` (boolean, default true) — kill-switch
 *     помощника «кто знает X». ON (Ship-On).
 *   - `knows_who.min_confidence` (number, default 0.5) — порог cosine similarity
 *     для зачёта носителя знания.
 *
 * Запуск:
 *   bun run scripts/seed-admin-setting-personal-brief.ts
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
    key: 'operations.personal_daily_brief.enabled',
    value: true,
    category: 'operations',
    section: 'personal_daily_brief',
    severity: 'medium',
    description:
      'Kill-switch персонального дневного брифа «Твой день» (cron каждый час, утреннее окно по таймзоне сотрудника, push через бюджет уведомлений). true (Ship-On).',
  },
  {
    key: 'operations.personal_daily_brief.morning_hour',
    value: 9,
    category: 'operations',
    section: 'personal_daily_brief',
    severity: 'low',
    description:
      'Локальный час утреннего окна (по Person.timezone), когда строится и отправляется персональный бриф «Твой день». По умолчанию 9.',
  },
  {
    key: 'operations.knows_who.enabled',
    value: true,
    category: 'operations',
    section: 'personal_daily_brief',
    severity: 'medium',
    description:
      'Kill-switch помощника «кто знает X» (семантический поиск носителя знания по блокеру/вопросу через skill-профили). true (Ship-On).',
  },
  {
    key: 'knows_who.min_confidence',
    value: 0.5,
    category: 'operations',
    section: 'personal_daily_brief',
    severity: 'low',
    description:
      'Порог cosine similarity, с которого носитель знания засчитывается в ответе «кто знает X». По умолчанию 0.5.',
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
  console.log('=== seed-admin-setting-personal-brief START ===');

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
  console.log('=== seed-admin-setting-personal-brief DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-personal-brief FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
