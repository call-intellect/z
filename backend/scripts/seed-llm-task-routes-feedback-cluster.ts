import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type LlmRouteTier } from '@prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }),
});

interface TierEntry {
  tier: LlmRouteTier;
  providerName: string;
  model: string;
  priorityWithinTier: number;
}

interface TaskRouteSeed {
  taskType: string;
  playbookSection: string;
  chain: TierEntry[];
}

const SEEDS: TaskRouteSeed[] = [
  {
    taskType: 'feedback.cluster',
    playbookSection:
      'plans/tz/2026-05-25-user-feedback-with-ai-clustering.md §«LLM-router и админка» — ' +
      'capable JSON-агент для ночной кластеризации обратной связи (batch ≤200 messages).',
    chain: [
      {
        tier: 'primary',
        providerName: 'deepseek',
        model: 'deepseek-v4-pro',
        priorityWithinTier: 0,
      },
      {
        tier: 'secondary',
        providerName: 'openai-via-proxy',
        model: 'gpt-5.4',
        priorityWithinTier: 0,
      },
      {
        tier: 'tertiary',
        providerName: 'kie',
        model: 'gemini-3-pro',
        priorityWithinTier: 0,
      },
      {
        tier: 'tertiary',
        providerName: 'grsai',
        model: 'gemini-3-pro',
        priorityWithinTier: 1,
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
  console.log(
    `=== seed-llm-task-routes-feedback-cluster START (updateExisting=${updateExisting}) ===`,
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
  console.log('=== seed-llm-task-routes-feedback-cluster DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-feedback-cluster FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export { SEEDS };
