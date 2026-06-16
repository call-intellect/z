import { type LlmRouteTier } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

interface TierEntry {
  tier: LlmRouteTier;
  providerName: string;
  model: string;
  priority?: number;
}

interface TaskRouteSeed {
  taskType: string;
  chain: TierEntry[];
}

const ROUTES: TaskRouteSeed[] = [
  {
    taskType: 'knowledge-specialists-combined',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-pro' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'dialog-multi-query-clone',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-pro' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'checkin-sentiment-batch',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-pro' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'experiment-extract',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'experiment-summarize-lessons',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
];

interface SeedStats {
  inserted: number;
  updated: number;
  skipped: number;
  protectedByAudit: number;
}

async function applySeedForTask(
  seed: TaskRouteSeed,
  force: boolean,
  stats: SeedStats,
): Promise<void> {
  if (!force) {
    const auditCount = await prisma.llmTaskRouteChange.count({
      where: { taskType: seed.taskType, tenantId: null },
    });
    if (auditCount > 0) {
      stats.protectedByAudit++;
      // eslint-disable-next-line no-console
      console.log(`[skipped:audit] ${seed.taskType} (audit log has ${auditCount} entries)`);
      return;
    }
  }

  for (let i = 0; i < seed.chain.length; i++) {
    const entry = seed.chain[i];
    if (!entry) continue;
    const priority = entry.priority ?? 0;
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
      console.log(`[inserted] ${seed.taskType} ${entry.tier} ${entry.providerName}:${entry.model}`);
      continue;
    }
    if (existing.editedByAdmin && !force) {
      stats.protectedByAudit++;
      // eslint-disable-next-line no-console
      console.log(`[skipped:edited] ${seed.taskType} ${entry.tier} (editedByAdmin, нужен --force)`);
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
    console.log(`[updated] ${seed.taskType} ${entry.tier} → ${entry.providerName}:${entry.model}`);
  }
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  // eslint-disable-next-line no-console
  console.log(`=== seed-llm-task-routes-missing-registry START (force=${force}) ===`);
  // eslint-disable-next-line no-console
  console.log(`Routes to apply: ${ROUTES.length}`);

  const stats: SeedStats = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    protectedByAudit: 0,
  };

  for (const seed of ROUTES) {
    await applySeedForTask(seed, force, stats);
  }

  // eslint-disable-next-line no-console
  console.log(
    `inserted=${stats.inserted}, updated=${stats.updated}, skipped=${stats.skipped}, protected_by_audit_or_edit=${stats.protectedByAudit}`,
  );
  // eslint-disable-next-line no-console
  console.log('=== seed-llm-task-routes-missing-registry DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-missing-registry FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export { ROUTES };
