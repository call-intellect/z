/**
 * SBA δ-1 — Seed маршрутов LLM для Orchestrator (multi-agent research).
 *
 *   - orchestrator-plan:        primary gpt-4o (важно качество reasoning плана).
 *   - orchestrator-subagent:    primary deepseek (массово+дёшево).
 *   - orchestrator-synthesize:  primary gpt-4o (качество финального синтеза).
 *   - orchestrator-verify:      primary ollama qwen3.5:9b (быстро+локально, дёшево).
 *
 * maxDataClass: 'internal' (запросы пользователя через UI — обычно internal).
 *
 * Запуск:
 *   bun run scripts/seed-llm-task-routes-orchestrator.ts
 *   bun run scripts/seed-llm-task-routes-orchestrator.ts --update-existing
 *
 * Идемпотентность (skill `safe-seed-rules`):
 *   - editedByAdmin=true → не перезаписываем.
 *   - без --update-existing → пропускаем существующие.
 *   - с --update-existing → обновляем model/priority/isActive.
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
    taskType: 'orchestrator-plan',
    playbookSection:
      '§δ-1 — план шагов: primary gpt-4o (важно качество reasoning), fallback deepseek + ollama.',
    chain: [
      { tier: 'primary', providerName: 'openai-via-proxy', model: 'gpt-4o' },
      { tier: 'secondary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3.5:9b' },
    ],
  },
  {
    taskType: 'orchestrator-subagent',
    playbookSection:
      '§δ-1 — массовые subagent-вызовы: primary deepseek (дёшево), fallback openai gpt-4o-mini + ollama.',
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
    taskType: 'orchestrator-synthesize',
    playbookSection:
      '§δ-1 — финальный синтез: primary gpt-4o, fallback deepseek + ollama.',
    chain: [
      { tier: 'primary', providerName: 'openai-via-proxy', model: 'gpt-4o' },
      { tier: 'secondary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3.5:9b' },
    ],
  },
  {
    taskType: 'orchestrator-verify',
    playbookSection:
      '§δ-1 — верификация synthesis: primary ollama qwen3.5:9b (быстро, локально, дёшево).',
    chain: [
      { tier: 'primary', providerName: 'ollama', model: 'qwen3.5:9b' },
      { tier: 'secondary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      {
        tier: 'tertiary',
        providerName: 'openai-via-proxy',
        model: 'gpt-4o-mini',
      },
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
    `=== seed-llm-task-routes-orchestrator START (updateExisting=${updateExisting}) ===`,
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
  console.log('=== seed-llm-task-routes-orchestrator DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-orchestrator FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export { SEEDS };
