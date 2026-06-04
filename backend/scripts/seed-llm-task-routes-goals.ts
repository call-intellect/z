/**
 * Goals OKR v2 (2026-06-02, plans/tz/2026-06-02-goals-okr-v2.md §3) — Seed
 * маршрутов LLM для 3 новых taskType'ов Specialist 3-14 «Goals»:
 *   - goal-extract          — из IdeaBlock (commitment/plan_item) → черновик
 *     Goal (outcome + горизонт + опц. измеримый KR). Может вернуть isGoal=false.
 *     Capable модель + JSON Schema strict.
 *   - goal-hierarchy-link   — арбитр {duplicate|child_of|standalone} по KNN
 *     top-5 существующим целям. Дешёвый арбитр.
 *   - goals-pulse-summarize — связный текст еженедельного пульса целей (Фаза 4),
 *     как operations-daily-digest.
 *
 * Цепочки (ТЗ §3, НЕ anthropic — memory `project_z_infra_and_ai`):
 *   goal-extract:           deepseek/deepseek-v4-pro   → openai-via-proxy/gpt-5.4-mini → ollama/qwen3.5:9b
 *   goal-hierarchy-link:    deepseek/deepseek-v4-flash → openai-via-proxy/gpt-5.4-mini → ollama/qwen3.5:9b
 *   goals-pulse-summarize:  deepseek/deepseek-v4-flash → openai-via-proxy/gpt-5.4-mini → ollama/qwen3.5:9b
 *
 * Запуск:
 *   bun run scripts/seed-llm-task-routes-goals.ts
 *   bun run scripts/seed-llm-task-routes-goals.ts --update-existing
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
  playbookSection: string;
  chain: TierEntry[];
}

const CHEAP_CHAIN: TierEntry[] = [
  { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
  { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
  { tier: 'tertiary', providerName: 'ollama', model: 'qwen3.5:9b' },
];

const SEEDS: TaskRouteSeed[] = [
  {
    taskType: 'goal-extract',
    playbookSection:
      '§2.1 capable / JSON Schema strict (outcome-цель + горизонт + KR) — паттерн decision-extract/sprint-helper-suggest',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-pro' },
      {
        tier: 'secondary',
        providerName: 'openai-via-proxy',
        model: 'gpt-5.4-mini',
      },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3.5:9b' },
    ],
  },
  {
    taskType: 'goal-hierarchy-link',
    playbookSection:
      '§2.2 cheap-арбитр / JSON Schema strict (verdict duplicate/child_of/standalone) — паттерн idea-cluster-merge/fact-supersede-detect',
    chain: CHEAP_CHAIN,
  },
  {
    taskType: 'goals-pulse-summarize',
    playbookSection:
      '§2.2 cheap / связный нарратив пульса (Фаза 4) — цепочка как operations-daily-digest',
    chain: CHEAP_CHAIN,
  },
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
      data: {
        model: entry.model,
        priority,
        isActive: true,
      },
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
    `=== seed-llm-task-routes-goals START (updateExisting=${updateExisting}) ===`,
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
  console.log('=== seed-llm-task-routes-goals DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-goals FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export { SEEDS };
