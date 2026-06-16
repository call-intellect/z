/**
 * ТЗ 2026-06-14 (assistant-router-dedup-and-prompt) — Seed AdminSetting для
 * крутилок помощника (Concierge).
 *
 * Регистрирует ключи динамической конфигурации (читаются через
 * `TypedConfigService.getDynamic`):
 *   - `concierge.history_pairs` (int, default 4) — глубина истории диалога
 *     (пар сообщений; 1 пара = реплика пользователя + ответ помощника).
 *     4 пары = 8 сообщений.
 *   - `concierge.clarify_min_confidence` (int, default 80) — порог самооценки
 *     понимания запроса (0–100): ниже — помощник переспрашивает. Высокий, с
 *     креном в вопрос. Жёсткого numeric-gate в коде нет — уточнение управляется
 *     промптом (Приложение A) + валидацией required-параметров в ToolRouter;
 *     крутилка зарезервирована для будущего тюнинга по проду.
 *
 * Запуск:
 *   bun run scripts/seed-admin-setting-concierge.ts
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
    key: 'concierge.history_pairs',
    value: 4,
    category: 'ai',
    section: 'concierge',
    severity: 'low',
    description:
      'Глубина истории диалога помощника (пар сообщений; 1 пара = реплика пользователя + ответ помощника). По умолчанию 4 пары (8 сообщений).',
  },
  {
    key: 'concierge.clarify_min_confidence',
    value: 80,
    category: 'ai',
    section: 'concierge',
    severity: 'medium',
    description:
      'Порог самооценки понимания (0–100): ниже — помощник переспрашивает. Лучше переспросить, чем ошибиться. По умолчанию 80.',
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
  console.log('=== seed-admin-setting-concierge START ===');

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
  console.log('=== seed-admin-setting-concierge DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-concierge FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
