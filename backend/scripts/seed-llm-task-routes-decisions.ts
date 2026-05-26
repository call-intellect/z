/**
 * SBA β-3 — Seed маршрутов LLM для 2 новых taskType'ов Specialist 3.3
 * (Decisions Registry):
 *   - decision-extract — извлечение черновика Decision из IdeaBlock
 *     (signalType=decision|rationale|decision_basis). JSON Schema strict.
 *   - decision-supersede-detect — арбитр { new | merge | supersedes } по
 *     top-K KNN-кандидатам. Та же сложность, что extract.
 *
 * Оба taskType маршрутизируются по `maxDataClass >= sensitive` (решения часто
 * стратегические — public-only провайдеры не должны их видеть). Цепочка
 * совпадает с extract из α-7 / β-2.
 *
 * Источник цепочек: `docs/reference/llm-models-playbook.md` §2.1 + verified-
 * карта `second-brain/01_projects/llm-providers-verified.md` (smoke 2026-05-21).
 *
 * Дефолтная тройная цепочка:
 *   primary   — deepseek-v4-flash       (быстрый, дешёвый, JSON Schema strict)
 *   secondary — openai-via-proxy gpt-5.4-mini (резерв при недоступности DeepSeek)
 *   tertiary  — ollama qwen3:30b        (локальный fallback, sensitive-ok)
 *
 * Запуск:
 *   bun run scripts/seed-llm-task-routes-decisions.ts
 *   bun run scripts/seed-llm-task-routes-decisions.ts --update-existing
 *
 * Идемпотентность (skill `safe-seed-rules`):
 *   - Записи с `editedByAdmin=true` НЕ перезаписываются.
 *   - Без флага — пропускаем все существующие записи (insert only).
 *   - С `--update-existing` — обновляем model/priority/isActive (но НЕ
 *     editedByAdmin).
 */

import { PrismaClient, type LlmRouteTier } from '@prisma/client';
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

const SEEDS: TaskRouteSeed[] = [
  {
    taskType: 'decision-extract',
    playbookSection:
      '§2.1 block-distill (similar complexity, structured JSON) + β-3 sub-TZ §11',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      {
        tier: 'secondary',
        providerName: 'openai-via-proxy',
        model: 'gpt-5.4-mini',
      },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3:30b' },
    ],
  },
  {
    taskType: 'decision-supersede-detect',
    playbookSection:
      '§2.1 block-distill (small JSON-in/JSON-out arbiter) + β-3 sub-TZ §11',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      {
        tier: 'secondary',
        providerName: 'openai-via-proxy',
        model: 'gpt-5.4-mini',
      },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3:30b' },
    ],
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
    `=== seed-llm-task-routes-decisions START (updateExisting=${updateExisting}) ===`,
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
  console.log('=== seed-llm-task-routes-decisions DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-decisions FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export { SEEDS };
