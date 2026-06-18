import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

const TASK_TYPE = 'task-dedupe';

const PROVIDERS = [
  { provider: 'deepseek', model: 'deepseek-v4-flash' },
  { provider: 'openai-via-proxy', model: 'gpt-5.4-mini' },
  { provider: 'ollama', model: 'qwen3.5:9b' },
];

async function main(): Promise<void> {
  const updateExisting = process.argv.includes('--update-existing');
  // eslint-disable-next-line no-console
  console.log(`=== seed-llm-task-routes-task-dedupe START (updateExisting=${updateExisting}) ===`);

  const existing = await prisma.llmTaskRoute.findFirst({
    where: { taskType: TASK_TYPE, tenantId: null },
  });

  if (!existing) {
    await prisma.llmTaskRoute.create({
      data: {
        taskType: TASK_TYPE,
        tenantId: null,
        providers: PROVIDERS as unknown as object,
        isActive: true,
      },
    });
    // eslint-disable-next-line no-console
    console.log(`[created] ${TASK_TYPE}`);
  } else if (updateExisting) {
    await prisma.llmTaskRoute.update({
      where: { id: existing.id },
      data: {
        providers: PROVIDERS as unknown as object,
        isActive: true,
      },
    });
    // eslint-disable-next-line no-console
    console.log(`[updated] ${TASK_TYPE}`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[skipped] ${TASK_TYPE} (уже существует)`);
  }

  // eslint-disable-next-line no-console
  console.log('=== seed-llm-task-routes-task-dedupe DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-task-dedupe FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
