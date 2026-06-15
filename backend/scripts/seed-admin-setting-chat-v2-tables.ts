/**
 * ТЗ 2026-06-15 (chat-v2 — таблицы как параллельный источник, ЧАСТЬ B §7) —
 * Seed AdminSetting для лимитов табличной ветки chat_v2.
 *
 * Регистрирует ключи динамической конфигурации (крутилки super_admin):
 *   - `chat_v2.table_context_max_rows` (int, default 20) — сколько строк умных
 *     таблиц максимум подмешивается в контекст синтезатора AI-чата. На счётный
 *     вопрос («сколько…») cap поднимается в коде ×2.
 *   - `chat_v2.table_context_max_tables` (int, default 2) — сколько релевантных
 *     таблиц максимум выбирается keyword-веткой (без доп. LLM-вызова в v1).
 *
 * Читаются через `TypedConfigService.getDynamic` (AdminSetting → default).
 *
 * Запуск:
 *   bun run scripts/seed-admin-setting-chat-v2-tables.ts
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
    key: 'chat_v2.table_context_max_rows',
    value: 20,
    category: 'ai',
    section: 'chat_v2',
    severity: 'low',
    description:
      'Сколько строк умных таблиц максимум подмешивается в контекст AI-чата (параллельная ветка таблиц). По умолчанию 20. На счётный вопрос («сколько…») cap поднимается ×2 в коде.',
  },
  {
    key: 'chat_v2.table_context_max_tables',
    value: 2,
    category: 'ai',
    section: 'chat_v2',
    severity: 'low',
    description:
      'Сколько релевантных умных таблиц максимум выбирает keyword-ветка chat_v2 (по name/description/именам колонок). По умолчанию 2.',
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
  console.log('=== seed-admin-setting-chat-v2-tables START ===');

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
  console.log('=== seed-admin-setting-chat-v2-tables DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-chat-v2-tables FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
