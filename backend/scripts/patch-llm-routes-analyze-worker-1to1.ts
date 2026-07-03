import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

interface TierEntry {
  tier: 'primary' | 'secondary' | 'tertiary';
  providerName: string;
  model: string;
}

const LEGACY_CHAIN: TierEntry[] = [
  { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-pro' },
  { tier: 'secondary', providerName: 'minimax', model: 'MiniMax-M2.5' },
  { tier: 'tertiary', providerName: 'openai-via-proxy', model: 'gpt-5-mini' },
];

const TASK_TYPES = ['summary', 'report-by-type', 'follow-up', 'custom-prompt', 'client-meeting-split'];

async function main(): Promise<void> {
  console.log('=== patch-llm-routes-analyze-worker-1to1 START ===');
  for (const taskType of TASK_TYPES) {
    const before = await prisma.llmTaskRoute.findMany({
      where: { tenantId: null, taskType, tier: { not: null } },
      select: { tier: true, providerName: true, model: true },
    });
    await prisma.$transaction(async (tx) => {
      await tx.llmTaskRoute.deleteMany({
        where: { tenantId: null, taskType, tier: { not: null } },
      });
      await tx.llmTaskRoute.createMany({
        data: LEGACY_CHAIN.map((e) => ({
          tenantId: null,
          taskType,
          tier: e.tier,
          priority: 0,
          providerName: e.providerName,
          model: e.model,
          isActive: true,
          editedByAdmin: true,
        })),
      });
    });
    console.log(
      `[reset] ${taskType}: было ${JSON.stringify(before)} → ${LEGACY_CHAIN.map((e) => `${e.tier}=${e.providerName}:${e.model}`).join(', ')}`,
    );
  }
  console.log('=== patch-llm-routes-analyze-worker-1to1 DONE ===');
}

main()
  .catch((err) => {
    console.error('patch-llm-routes-analyze-worker-1to1 FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
