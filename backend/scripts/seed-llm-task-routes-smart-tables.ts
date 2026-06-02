/**
 * Smart-tables auto-creation (2026-06-02, Фаза 1) — Seed маршрутов LLM для
 * 3 новых taskType'ов Text-to-Schema:
 *   - table-infer-schema    — DRAFT: NL -> черновик схемы.
 *   - table-architect-pass  — ARCHITECT-рефлексия схемы.
 *   - table-entity-check    — сверка entitySync.type с доступными.
 *
 * Capable модель (доменное моделирование структуры таблицы) + JSON object.
 * Цепочка одинаковая для всех трёх (тот же capable-профиль, что у
 * skill-trait-detect / sprint-helper-suggest):
 *   primary   — deepseek deepseek-v4-pro
 *   secondary — openai-via-proxy gpt-5.4-mini
 *   tertiary  — ollama qwen3.5:9b
 *
 * NB: LlmRouter имеет code-fallback DEFAULT_FALLBACK_CHAIN
 * (deepseek -> openai -> ollama), поэтому без этого seed router НЕ падает,
 * но дефолтная цепочка использует deepseek-chat (не pro). Этот seed поднимает
 * primary до deepseek-v4-pro (capable).
 *
 * Запуск:
 *   bun run scripts/seed-llm-task-routes-smart-tables.ts
 *   bun run scripts/seed-llm-task-routes-smart-tables.ts --update-existing
 *
 * Идемпотентность (skill `safe-seed-rules`):
 *   - Записи с `editedByAdmin=true` НЕ перезаписываются.
 *   - Без флага — пропускаем существующие записи (insert only).
 *   - С `--update-existing` — обновляем model/priority/isActive (НЕ editedByAdmin).
 */

import { type LlmRouteTier } from '@prisma/client';

import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

interface TierEntry {
  tier: LlmRouteTier;
  providerName: string;
  model: string;
}

interface TaskRouteSeed {
  taskType: string;
  chain: TierEntry[];
}

const CAPABLE_CHAIN: TierEntry[] = [
  { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-pro' },
  { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
  { tier: 'tertiary', providerName: 'ollama', model: 'qwen3.5:9b' },
];

const SEEDS: TaskRouteSeed[] = [
  { taskType: 'table-infer-schema', chain: CAPABLE_CHAIN },
  { taskType: 'table-architect-pass', chain: CAPABLE_CHAIN },
  { taskType: 'table-entity-check', chain: CAPABLE_CHAIN },
];

interface SeedStats {
  inserted: number;
  updated: number;
  skipped: number;
  protectedByAudit: number;
}

async function applySeed(
  seed: TaskRouteSeed,
  updateExisting: boolean,
  stats: SeedStats,
): Promise<void> {
  for (let i = 0; i < seed.chain.length; i++) {
    const entry = seed.chain[i];
    if (!entry) continue;
    const priority = i;
    const existing = await prisma.llmTaskRoute.findFirst({
      where: {
        taskType: seed.taskType,
        tenantId: null,
        tier: entry.tier,
        providerName: entry.providerName,
      },
    });
    if (!existing) {
      await prisma.llmTaskRoute.create({
        data: {
          taskType: seed.taskType,
          tenantId: null,
          tier: entry.tier,
          providerName: entry.providerName,
          model: entry.model,
          priority,
          providers: null,
          isActive: true,
          editedByAdmin: false,
        },
      });
      stats.inserted++;
      // eslint-disable-next-line no-console
      console.log(
        `[insert] ${seed.taskType}/${entry.tier}/${entry.providerName}:${entry.model}`,
      );
      continue;
    }
    if (existing.editedByAdmin) {
      stats.protectedByAudit++;
      // eslint-disable-next-line no-console
      console.log(
        `[skip:edited-by-admin] ${seed.taskType}/${entry.tier}/${entry.providerName}`,
      );
      continue;
    }
    if (!updateExisting) {
      stats.skipped++;
      continue;
    }
    if (
      existing.model === entry.model &&
      existing.priority === priority &&
      existing.isActive === true
    ) {
      stats.skipped++;
      continue;
    }
    await prisma.llmTaskRoute.update({
      where: { id: existing.id },
      data: { model: entry.model, priority, isActive: true },
    });
    stats.updated++;
    // eslint-disable-next-line no-console
    console.log(
      `[update] ${seed.taskType}/${entry.tier}/${entry.providerName}:${entry.model}`,
    );
  }
}

async function main(): Promise<void> {
  const updateExisting = process.argv.includes('--update-existing');
  // eslint-disable-next-line no-console
  console.log(
    `=== seed-llm-task-routes-smart-tables START (updateExisting=${updateExisting}) ===`,
  );
  // eslint-disable-next-line no-console
  console.log(`TaskTypes: ${SEEDS.map((s) => s.taskType).join(', ')}`);

  const stats: SeedStats = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    protectedByAudit: 0,
  };

  for (const seed of SEEDS) {
    await applySeed(seed, updateExisting, stats);
  }

  // eslint-disable-next-line no-console
  console.log(
    `inserted=${stats.inserted}, updated=${stats.updated}, skipped=${stats.skipped}, protected_by_admin=${stats.protectedByAudit}`,
  );
  // eslint-disable-next-line no-console
  console.log('=== seed-llm-task-routes-smart-tables DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-smart-tables FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export { SEEDS };
