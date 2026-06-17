import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

interface ProviderEntry {
  provider: string;
  model: string;
}

interface TaskRoute {
  taskType: string;
  providers: ProviderEntry[];
  isActive: boolean;
}

const ROUTES: TaskRoute[] = [
  {
    taskType: 'compile-org-document',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-pro' },
      { provider: 'openai-via-proxy', model: 'gpt-5.4' },
      { provider: 'ollama', model: 'qwen3.5:9b' },
    ],
    isActive: true,
  },
];

async function main(): Promise<void> {
  const updateExisting = process.argv.includes('--update-existing');

  console.log(
    `=== seed-llm-task-routes-compile-org-document START (updateExisting=${updateExisting}) ===`,
  );

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let protectedByAdmin = 0;

  for (const route of ROUTES) {
    const existing = await prisma.llmTaskRoute.findFirst({
      where: { taskType: route.taskType, tenantId: null },
    });
    if (!existing) {
      await prisma.llmTaskRoute.create({
        data: {
          taskType: route.taskType,
          tenantId: null,
          providers: route.providers as unknown as object,
          isActive: route.isActive,
        },
      });
      inserted++;

      console.log(`[created] ${route.taskType}`);
      continue;
    }
    if (existing.editedByAdmin) {
      protectedByAdmin++;

      console.log(`[skip:edited-by-admin] ${route.taskType}`);
      continue;
    }
    if (!updateExisting) {
      skipped++;

      console.log(`[skip] ${route.taskType}`);
      continue;
    }
    await prisma.llmTaskRoute.update({
      where: { id: existing.id },
      data: {
        providers: route.providers as unknown as object,
        isActive: route.isActive,
      },
    });
    updated++;

    console.log(`[updated] ${route.taskType}`);
  }

  console.log(
    `inserted=${inserted}, updated=${updated}, skipped=${skipped}, protected_by_admin=${protectedByAdmin}`,
  );

  console.log('=== seed-llm-task-routes-compile-org-document DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-llm-task-routes-compile-org-document FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export { ROUTES };
