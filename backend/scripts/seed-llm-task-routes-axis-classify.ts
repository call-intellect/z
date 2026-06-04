/**
 * SBA α-3 wave 3 — Seed LLM-маршрутов для AxisClassifier + LLM-fallback Router.
 *
 * Регистрирует 2 LlmTaskType с тройной цепочкой primary/secondary/tertiary:
 *
 *   - `axis-classify` — классификация IdeaBlock по 4 осям (who/functional/
 *     contextual/temporal). Дёшево и часто — primary Ollama qwen3.5:9b
 *     (локальная, бесплатно), fallback на DeepSeek + OpenAI proxy.
 *
 *   - `router-fallback` — fallback роутер: для unmatched signalType определяем
 *     специалистов через LLM (≤2% потока). Тот же провайдер-профиль.
 *
 * Источник цепочки: docs/reference/llm-models-playbook.md §2.x (дешёвая
 * частая задача) + verified-карта second-brain/01_projects/llm-providers-verified.md
 * (smoke 2026-05-21).
 *
 * Запуск:
 *   bun run scripts/seed-llm-task-routes-axis-classify.ts
 *   bun run scripts/seed-llm-task-routes-axis-classify.ts --update-existing
 *
 * Идемпотентность (skill `safe-seed-rules`):
 *   - `editedByAdmin=true` → НЕ перезаписываем (даже с `--update-existing`).
 *   - Без флага — пропускаем все существующие записи (insert only).
 *   - С `--update-existing` — обновляем model/priority/isActive.
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

/**
 * Цепочка одинакова для обеих задач: дешёвая, частая, нечувствительная к
 * данным (max dataClass=internal). primary — Ollama (бесплатная), secondary
 * — DeepSeek-flash, tertiary — gpt-4o-mini (через прокси).
 */
const COMMON_CHAIN: TierEntry[] = [
  { tier: 'primary', providerName: 'ollama', model: 'qwen3.5:9b' },
  { tier: 'secondary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
  { tier: 'tertiary', providerName: 'openai-via-proxy', model: 'gpt-4o-mini' },
];

const SEEDS: TaskRouteSeed[] = [
  {
    taskType: 'axis-classify',
    playbookSection:
      '§2.x (дешёвая частая классификация) + α-3 wave 3 sub-TZ §9',
    chain: COMMON_CHAIN,
  },
  {
    taskType: 'router-fallback',
    playbookSection:
      '§2.x (дешёвая частая классификация) + α-3 wave 3 sub-TZ §9',
    chain: COMMON_CHAIN,
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
    `=== seed-llm-task-routes-axis-classify START (updateExisting=${updateExisting}) ===`,
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
  console.log('=== seed-llm-task-routes-axis-classify DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-axis-classify FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export { SEEDS };
