/**
 * SBA β-4 — Seed маршрутов LLM для 2 новых taskType'ов Specialist 3.5
 * (Insights Radar):
 *   - insight-extract — извлечение черновика Insight из IdeaBlock
 *     (signalType ∈ pain|risk|churn_risk|objection). JSON Schema strict.
 *   - insight-link-to-decisions — арбитр на пары (Insight, Decision):
 *     отбирает Decision'ы, которые могли спровоцировать сигнал.
 *
 * Оба taskType маршрутизируются по `maxDataClass >= internal` (insight по
 * умолчанию internal; для escalation на sensitive — provider'ы с
 * maxDataClass='sensitive' тоже подойдут).
 *
 * Источник цепочек: `docs/reference/llm-models-playbook.md` §2.1 + verified-
 * карта `second-brain/01_projects/llm-providers-verified.md` (smoke 2026-05-21).
 *
 * Дефолтная тройная цепочка (по образцу β-3):
 *   insight-extract:
 *     primary   — deepseek-v4-flash       (быстрый, дешёвый, JSON Schema strict)
 *     secondary — openai-via-proxy gpt-5.4-mini (резерв)
 *     tertiary  — ollama qwen3:30b        (локальный fallback)
 *
 *   insight-link-to-decisions (select-task — дешевле):
 *     primary   — deepseek-v4-flash
 *     secondary — openai-via-proxy gpt-5.4-nano  (дешевле для select-арбитра)
 *     tertiary  — ollama qwen3:30b
 *
 * Запуск:
 *   bun run scripts/seed-llm-task-routes-insights.ts
 *   bun run scripts/seed-llm-task-routes-insights.ts --update-existing
 *
 * Идемпотентность (skill `safe-seed-rules`):
 *   - Записи с `editedByAdmin=true` НЕ перезаписываются.
 *   - Без флага — пропускаем все существующие записи (insert only).
 *   - С `--update-existing` — обновляем model/priority/isActive (но НЕ
 *     editedByAdmin).
 */

import { PrismaClient, type LlmRouteTier } from '@prisma/client';

const prisma = new PrismaClient();

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
    taskType: 'insight-extract',
    playbookSection:
      '§2.1 block-distill (similar complexity, structured JSON) + β-4 sub-TZ §10',
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
    taskType: 'insight-link-to-decisions',
    playbookSection:
      '§2.1 small select-task (JSON-in/JSON-out arbiter) + β-4 sub-TZ §10',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      {
        tier: 'secondary',
        providerName: 'openai-via-proxy',
        model: 'gpt-5.4-nano',
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
    `=== seed-llm-task-routes-insights START (updateExisting=${updateExisting}) ===`,
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
  console.log('=== seed-llm-task-routes-insights DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-insights FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export { SEEDS };
