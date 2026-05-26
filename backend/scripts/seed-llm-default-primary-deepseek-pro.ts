/**
 * Глобальный дефолт primary = `deepseek/deepseek-v4-pro` для ВСЕХ ИИ-агентов
 * (всех `LlmTaskType` из `ALL_LLM_TASK_TYPES`).
 *
 * Зачем: владелец проекта установил единый дефолт по умолчанию. Любой
 * отдельный taskType можно переключить из админки `/admin/ai-models/[taskType]`
 * на любую другую модель в любой момент — этот seed просто ставит стартовую
 * точку.
 *
 * Идемпотентность (skill `safe-seed-rules`):
 *   - `editedByAdmin=true` — никогда не перезаписываем (админ поменял руками).
 *   - Без флага `--update-existing` — пропускаем существующие записи.
 *   - С флагом `--update-existing` — обновляем `model` на `deepseek-v4-pro` и
 *     `priority=0`, но НЕ трогаем `editedByAdmin`.
 *   - secondary/tertiary НЕ ТРОГАЕМ — оставляем как есть в существующих
 *     seed-скриптах (этот скрипт отвечает только за primary).
 *
 * Безопасность по dataClass: для taskType, где `dataClass = 'sensitive'`/
 * `'private'`, DeepSeek будет автоматически пропущен `LlmRouter`'ом
 * (capability='internal'). Для них secondary/tertiary из существующих seed
 * остаются актуальными.
 *
 * Запуск:
 *   bun run scripts/seed-llm-default-primary-deepseek-pro.ts
 *   bun run scripts/seed-llm-default-primary-deepseek-pro.ts --update-existing
 */

import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

import { ALL_LLM_TASK_TYPES } from '../src/modules/ai/services/llm-router.service';

const prisma = createPrismaClient();

const TARGET_PROVIDER = 'deepseek';
const TARGET_MODEL = 'deepseek-v4-pro';

interface SeedStats {
  inserted: number;
  updated: number;
  skipped: number;
  protectedByAdmin: number;
  protectedByConflictingPrimary: number;
}

async function applyForTaskType(
  taskType: string,
  updateExisting: boolean,
  stats: SeedStats,
): Promise<void> {
  // 1. Существующая primary-запись именно для (deepseek, deepseek-v4-pro)?
  const exactMatch = await prisma.llmTaskRoute.findFirst({
    where: {
      taskType,
      tenantId: null,
      tier: 'primary',
      providerName: TARGET_PROVIDER,
    },
  });

  if (exactMatch) {
    if (exactMatch.editedByAdmin) {
      stats.protectedByAdmin++;
      // eslint-disable-next-line no-console
      console.log(
        `[skip:edited-by-admin] ${taskType}/primary/deepseek (admin владеет)`,
      );
      return;
    }
    if (
      exactMatch.model === TARGET_MODEL &&
      exactMatch.priority === 0 &&
      exactMatch.isActive === true
    ) {
      stats.skipped++;
      return;
    }
    if (!updateExisting) {
      stats.skipped++;
      // eslint-disable-next-line no-console
      console.log(
        `[skip:exists-different] ${taskType}/primary/deepseek уже есть c model=${exactMatch.model}; передай --update-existing чтобы обновить до ${TARGET_MODEL}`,
      );
      return;
    }
    await prisma.llmTaskRoute.update({
      where: { id: exactMatch.id },
      data: { model: TARGET_MODEL, priority: 0, isActive: true },
    });
    stats.updated++;
    // eslint-disable-next-line no-console
    console.log(`[update] ${taskType}/primary/deepseek → ${TARGET_MODEL}`);
    return;
  }

  // 2. Есть ли primary от ДРУГОГО провайдера? Если да — это конфликт.
  //    В одном tier'е может быть несколько записей с разным providerName
  //    (constraint @@unique([taskType, tenantId, tier, providerName])).
  //    Безопаснее НЕ вытеснять чужого primary автоматически: понизим его до
  //    priority=1 в том же tier — пользователь дальше переключит в админке.
  const otherPrimary = await prisma.llmTaskRoute.findFirst({
    where: { taskType, tenantId: null, tier: 'primary' },
  });
  if (otherPrimary && !updateExisting) {
    stats.protectedByConflictingPrimary++;
    // eslint-disable-next-line no-console
    console.log(
      `[skip:other-primary-exists] ${taskType}/primary занят ${otherPrimary.providerName}:${otherPrimary.model}; передай --update-existing чтобы добавить deepseek-v4-pro вторым в primary tier (priority=1)`,
    );
    return;
  }

  // 3. Вставляем primary с DeepSeek-V4-Pro. priority=0 если в tier'е пусто,
  //    иначе следующий свободный.
  const existingPrimaryCount = await prisma.llmTaskRoute.count({
    where: { taskType, tenantId: null, tier: 'primary' },
  });
  await prisma.llmTaskRoute.create({
    data: {
      taskType,
      tenantId: null,
      tier: 'primary',
      providerName: TARGET_PROVIDER,
      model: TARGET_MODEL,
      priority: existingPrimaryCount === 0 ? 0 : existingPrimaryCount,
      providers: null,
      isActive: true,
      editedByAdmin: false,
    },
  });
  stats.inserted++;
  // eslint-disable-next-line no-console
  console.log(
    `[insert] ${taskType}/primary/deepseek:${TARGET_MODEL} priority=${existingPrimaryCount === 0 ? 0 : existingPrimaryCount}`,
  );
}

async function main(): Promise<void> {
  const updateExisting = process.argv.includes('--update-existing');
  // eslint-disable-next-line no-console
  console.log(
    `=== seed-llm-default-primary-deepseek-pro START (updateExisting=${updateExisting}) ===`,
  );
  // eslint-disable-next-line no-console
  console.log(`taskTypes total: ${ALL_LLM_TASK_TYPES.length}`);

  const stats: SeedStats = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    protectedByAdmin: 0,
    protectedByConflictingPrimary: 0,
  };

  for (const taskType of ALL_LLM_TASK_TYPES) {
    await applyForTaskType(taskType, updateExisting, stats);
  }

  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log(
    `inserted=${stats.inserted}, updated=${stats.updated}, skipped=${stats.skipped}, ` +
      `protected_by_admin=${stats.protectedByAdmin}, protected_by_conflicting_primary=${stats.protectedByConflictingPrimary}`,
  );
  // eslint-disable-next-line no-console
  console.log('=== seed-llm-default-primary-deepseek-pro DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-default-primary-deepseek-pro FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
