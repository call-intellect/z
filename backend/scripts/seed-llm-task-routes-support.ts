import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

interface RouteSeed {
  tier: 'primary' | 'secondary' | 'tertiary';
  provider: string;
  model: string;
  priority: number;
  maxDataClass: 'public' | 'internal' | 'sensitive' | 'private';
}

const DRAFT_ROUTES: RouteSeed[] = [
  {
    tier: 'primary',
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    priority: 0,
    maxDataClass: 'internal',
  },
  {
    tier: 'secondary',
    provider: 'openai-via-proxy',
    model: 'gpt-5.4-mini',
    priority: 0,
    maxDataClass: 'internal',
  },
  {
    tier: 'tertiary',
    provider: 'ollama',
    model: 'qwen3.5:9b',
    priority: 0,
    maxDataClass: 'private',
  },
];

const JUDGE_ROUTES: RouteSeed[] = [
  {
    tier: 'primary',
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    priority: 0,
    maxDataClass: 'internal',
  },
  {
    tier: 'secondary',
    provider: 'openai-via-proxy',
    model: 'gpt-5.4-mini',
    priority: 0,
    maxDataClass: 'internal',
  },
  {
    tier: 'tertiary',
    provider: 'ollama',
    model: 'qwen3.5:9b',
    priority: 0,
    maxDataClass: 'private',
  },
];

const TASK_ROUTES: Array<{ taskType: string; routes: RouteSeed[] }> = [
  { taskType: 'support-clone-draft', routes: DRAFT_ROUTES },
  { taskType: 'support-answer-critic', routes: JUDGE_ROUTES },
  { taskType: 'support-edit-classify', routes: JUDGE_ROUTES },
  { taskType: 'support-contour-curate', routes: DRAFT_ROUTES },
];

async function main(): Promise<void> {
  const updateExisting = process.argv.includes('--update-existing');

  console.log(
    `=== seed-llm-task-routes-support START (taskTypes=${TASK_ROUTES.map((t) => t.taskType).join(',')}, updateExisting=${updateExisting}) ===`,
  );

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let skippedEdited = 0;

  for (const { taskType, routes } of TASK_ROUTES) {
    for (const r of routes) {
      const existing = await prisma.llmTaskRoute.findFirst({
        where: {
          taskType,
          tenantId: null,
          tier: r.tier,
          providerName: r.provider,
        },
      });
      if (existing) {
        if (existing.editedByAdmin) {
          skippedEdited++;

          console.log(
            `[skipped:edited] ${taskType} ${r.tier} ${r.provider}:${r.model} (admin отредактировал — не трогаем)`,
          );
          continue;
        }
        if (!updateExisting) {
          skipped++;

          console.log(`[skipped:exists] ${taskType} ${r.tier} ${r.provider}:${r.model}`);
          continue;
        }
        if (
          existing.model === r.model &&
          existing.priority === r.priority &&
          existing.isActive === true &&
          existing.requiredDataClass === r.maxDataClass
        ) {
          skipped++;
          continue;
        }
        await prisma.llmTaskRoute.update({
          where: { id: existing.id },
          data: {
            model: r.model,
            priority: r.priority,
            isActive: true,
            requiredDataClass: r.maxDataClass,
          },
        });
        updated++;

        console.log(`[updated] ${taskType} ${r.tier} ${r.provider}:${r.model}`);
        continue;
      }
      await prisma.llmTaskRoute.create({
        data: {
          taskType,
          tenantId: null,
          tier: r.tier,
          providerName: r.provider,
          model: r.model,
          priority: r.priority,
          isActive: true,
          editedByAdmin: false,
          requiredDataClass: r.maxDataClass,
        },
      });
      inserted++;

      console.log(`[created] ${taskType} ${r.tier} ${r.provider}:${r.model}`);
    }
  }

  console.log(
    `inserted: ${inserted}, updated: ${updated}, skipped(exists): ${skipped}, skipped(edited): ${skippedEdited}`,
  );

  console.log('=== seed-llm-task-routes-support DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-llm-task-routes-support FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
