import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

const BEHAVIOR_REFINE_PROVIDERS = [
  { provider: 'openai-via-proxy', model: 'gpt-5.4-nano' },
  { provider: 'deepseek', model: 'deepseek-v4-flash' },
  { provider: 'ollama', model: 'qwen3.5:9b' },
];

async function main(): Promise<void> {
  const updateExisting = process.argv.includes('--update-existing');
  // eslint-disable-next-line no-console
  console.log(`=== seed-llm-task-routes-phase-B START (updateExisting=${updateExisting}) ===`);

  const taskType = 'behavior-refine';
  const existing = await prisma.llmTaskRoute.findFirst({
    where: { taskType, tenantId: null },
  });

  if (!existing) {
    await prisma.llmTaskRoute.create({
      data: {
        taskType,
        tenantId: null,
        providers: BEHAVIOR_REFINE_PROVIDERS as unknown as object,
        isActive: true,
        requiredDataClass: 'internal',
      },
    });
    // eslint-disable-next-line no-console
    console.log(`[created] ${taskType}: 3 providers (primary=gpt-5.4-nano)`);
  } else if (updateExisting) {
    await prisma.llmTaskRoute.update({
      where: { id: existing.id },
      data: {
        providers: BEHAVIOR_REFINE_PROVIDERS as unknown as object,
        isActive: true,
        requiredDataClass: 'internal',
      },
    });
    // eslint-disable-next-line no-console
    console.log(`[updated] ${taskType}: 3 providers (primary=gpt-5.4-nano)`);
  } else {
    // eslint-disable-next-line no-console
    console.log(
      `[skipped] ${taskType}: existing route preserved (use --update-existing to overwrite)`,
    );
  }

  // eslint-disable-next-line no-console
  console.log('=== seed-llm-task-routes-phase-B DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-phase-B FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
