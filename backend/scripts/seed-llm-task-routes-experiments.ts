/**
 * SBA β-6 — Seed маршрутов LLM для 2 новых taskType'ов Experiment Tracker
 * (Specialist 3.9):
 *   - experiment-extract — извлечение / обновление Experiment-карточки из
 *     IdeaBlock (signalType ∈ hypothesis|result|lesson). JSON Schema strict.
 *   - experiment-summarize-lessons — арбитр-резюмировщик уроков по серии
 *     завершённых экспериментов (используется в digest'ах γ+; на β-6 запись
 *     создаётся для зарезервированной цепочки).
 *
 * Оба taskType маршрутизируются по `maxDataClass >= internal` (эксперимент по
 * умолчанию internal — операционная история).
 *
 * Источник цепочек: `docs/reference/llm-models-playbook.md` §2.1 + verified-
 * карта `second-brain/01_projects/llm-providers-verified.md`.
 *
 * Дефолтная тройная цепочка (по образцу β-3/β-4):
 *   experiment-extract:
 *     primary   — deepseek deepseek-chat       (дешёвый, JSON Schema strict)
 *     secondary — openai-via-proxy gpt-4o-mini (резерв)
 *     tertiary  — ollama qwen3.5:9b            (локальный fallback)
 *
 *   experiment-summarize-lessons (digest-task — дешевле):
 *     primary   — deepseek deepseek-chat
 *     secondary — openai-via-proxy gpt-4o-mini
 *     tertiary  — ollama qwen3.5:9b
 *
 * Запуск:
 *   bun run scripts/seed-llm-task-routes-experiments.ts
 *   bun run scripts/seed-llm-task-routes-experiments.ts --update-existing
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
    taskType: 'experiment-extract',
    playbookSection:
      '§2.1 block-distill (similar complexity, structured JSON) + β-6 sub-TZ §9',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      {
        tier: 'secondary',
        providerName: 'openai-via-proxy',
        model: 'gpt-4o-mini',
      },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3.5:9b' },
    ],
  },
  {
    taskType: 'experiment-summarize-lessons',
    playbookSection:
      '§2.1 digest-task (multi-document summarization) + β-6 sub-TZ §9',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      {
        tier: 'secondary',
        providerName: 'openai-via-proxy',
        model: 'gpt-4o-mini',
      },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3.5:9b' },
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
    `=== seed-llm-task-routes-experiments START (updateExisting=${updateExisting}) ===`,
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
  console.log('=== seed-llm-task-routes-experiments DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-experiments FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export { SEEDS };
