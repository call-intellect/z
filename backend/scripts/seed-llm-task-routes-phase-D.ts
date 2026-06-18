import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

interface ProviderEntry {
  provider: string;
  model: string;
  tier: 'primary' | 'secondary' | 'tertiary';
}

const TRANSCRIPT_CLEAN_REFINE_PROVIDERS: ProviderEntry[] = [
  { provider: 'openai-via-proxy', model: 'gpt-5.4-nano', tier: 'primary' },
  { provider: 'deepseek', model: 'deepseek-v4-flash', tier: 'secondary' },
  { provider: 'ollama', model: 'qwen3.5:9b', tier: 'tertiary' },
];

async function main(): Promise<void> {
  const updateExisting = process.argv.includes('--update-existing');
  // eslint-disable-next-line no-console
  console.log(`=== seed-llm-task-routes-phase-D START (updateExisting=${updateExisting}) ===`);

  const taskType = 'transcript-clean-refine';
  const existing = await prisma.llmTaskRoute.findFirst({
    where: { taskType, tenantId: null },
  });

  if (!existing) {
    await prisma.llmTaskRoute.create({
      data: {
        taskType,
        tenantId: null,
        providers: TRANSCRIPT_CLEAN_REFINE_PROVIDERS as unknown as object,
        isActive: true,
      },
    });
    // eslint-disable-next-line no-console
    console.log(`[created] ${taskType}`);
  } else if (updateExisting) {
    await prisma.llmTaskRoute.update({
      where: { id: existing.id },
      data: {
        providers: TRANSCRIPT_CLEAN_REFINE_PROVIDERS as unknown as object,
        isActive: true,
      },
    });
    // eslint-disable-next-line no-console
    console.log(`[updated] ${taskType}`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[skipped] ${taskType} (admin-edited; pass --update-existing to override)`);
  }

  // eslint-disable-next-line no-console
  console.log('=== seed-llm-task-routes-phase-D DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-phase-D FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });
