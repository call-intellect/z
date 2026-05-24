/**
 * Tracker Phase 3 part C (Wave 3, 2026-05-24) — Seed маршрутов LLM для
 * AI-suggest при создании задачи + Goal-suggest.
 *
 *   - issue-infer-fields: primary=deepseek/deepseek-chat,
 *                          secondary=openai-via-proxy/gpt-4o-mini,
 *                          tertiary=ollama/qwen3.5:9b.
 *   - issue-goal-suggest: primary=deepseek/deepseek-chat,
 *                          secondary=openai-via-proxy/gpt-4o-mini,
 *                          tertiary=ollama/qwen3.5:9b.
 *
 * Источник цепочки: docs/reference/llm-models-playbook.md +
 * second-brain/01_projects/llm-providers-verified.md.
 *
 * Запуск:
 *   bun run scripts/seed-llm-task-routes-tracker-phase3-c.ts
 *   bun run scripts/seed-llm-task-routes-tracker-phase3-c.ts --update-existing
 *
 * Идемпотентность (skill `safe-seed-rules`):
 *   - editedByAdmin=true — не перезаписываем.
 *   - Без флага — пропускаем existing.
 *   - С `--update-existing` — обновляем model/priority/isActive (но НЕ editedByAdmin).
 *
 * Отдельный файл от Agent B (`seed-llm-task-routes-tracker-phase3.ts`),
 * чтобы избежать конфликтов при параллельной разработке.
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
    taskType: 'issue-infer-fields',
    playbookSection: 'Tracker Phase 3 part C — AI-suggest при создании задачи',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-chat' },
      {
        tier: 'secondary',
        providerName: 'openai-via-proxy',
        model: 'gpt-4o-mini',
      },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3.5:9b' },
    ],
  },
  {
    taskType: 'issue-goal-suggest',
    playbookSection: 'Tracker Phase 3 part C — Goal-suggest fallback после KNN',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-chat' },
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
    `=== seed-llm-task-routes-tracker-phase3-c START (updateExisting=${updateExisting}) ===`,
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
  console.log('=== seed-llm-task-routes-tracker-phase3-c DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-tracker-phase3-c FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export { SEEDS };
