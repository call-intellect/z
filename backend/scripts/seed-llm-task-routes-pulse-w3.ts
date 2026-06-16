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

const SEEDS: TaskRouteSeed[] = [
  {
    taskType: 'team-health-analyzer',
    playbookSection:
      '§2.2 cheap JSON-strict (классификация 5 факторов low/medium/high) — паттерн checkin-sentiment',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      {
        tier: 'secondary',
        providerName: 'openai-via-proxy',
        model: 'gpt-5.4-mini',
      },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3.5:9b' },
    ],
  },
  {
    taskType: 'reflection-quality-scorer',
    playbookSection:
      '§2.2 cheap JSON-strict (3-axis scoring 0..1) — паттерн axis-classify / concierge-step-prm',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      {
        tier: 'secondary',
        providerName: 'openai-via-proxy',
        model: 'gpt-5.4-mini',
      },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3.5:9b' },
    ],
  },
  {
    taskType: 'hr-recommender',
    playbookSection:
      '§2.1 capable / JSON Schema strict (нюансные рекомендации, тон) — паттерн sprint-helper-suggest',
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
      console.log(`[insert] ${seed.taskType}/${entry.tier}/${entry.providerName}:${entry.model}`);
      continue;
    }
    if (existing.editedByAdmin) {
      stats.protectedByAudit++;
      // eslint-disable-next-line no-console
      console.log(`[skip:edited-by-admin] ${seed.taskType}/${entry.tier}/${entry.providerName}`);
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
    console.log(`[update] ${seed.taskType}/${entry.tier}/${entry.providerName}:${entry.model}`);
  }
}

async function main(): Promise<void> {
  const updateExisting = process.argv.includes('--update-existing');
  // eslint-disable-next-line no-console
  console.log(`=== seed-llm-task-routes-pulse-w3 START (updateExisting=${updateExisting}) ===`);
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
  console.log('=== seed-llm-task-routes-pulse-w3 DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-pulse-w3 FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export { SEEDS };
