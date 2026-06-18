import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

interface RouteSeed {
  taskType: string;
  tier: 'primary' | 'secondary' | 'tertiary';
  provider: string;
  model: string;
  priority: number;
  maxDataClass: 'public' | 'internal' | 'sensitive' | 'private';
}

const ROUTES: RouteSeed[] = [
  {
    taskType: 'dialog-multi-query-clone',
    tier: 'primary',
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    priority: 0,
    maxDataClass: 'internal',
  },
  {
    taskType: 'dialog-multi-query-clone',
    tier: 'secondary',
    provider: 'openai-via-proxy',
    model: 'gpt-5.4-mini',
    priority: 0,
    maxDataClass: 'internal',
  },
  {
    taskType: 'dialog-multi-query-clone',
    tier: 'tertiary',
    provider: 'ollama',
    model: 'qwen3.5:9b',
    priority: 0,
    maxDataClass: 'private',
  },
  {
    taskType: 'clone-respond',
    tier: 'primary',
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    priority: 0,
    maxDataClass: 'internal',
  },
];

async function main(): Promise<void> {
  const updateExisting = process.argv.includes('--update-existing');
  // eslint-disable-next-line no-console
  console.log(`=== seed-llm-task-routes-clone-v2 START (updateExisting=${updateExisting}) ===`);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let skippedEdited = 0;

  for (const r of ROUTES) {
    const existing = await prisma.llmTaskRoute.findFirst({
      where: {
        taskType: r.taskType,
        tenantId: null,
        tier: r.tier,
        providerName: r.provider,
      },
    });
    if (existing) {
      if (existing.editedByAdmin) {
        skippedEdited++;
        // eslint-disable-next-line no-console
        console.log(
          `[skipped:edited] ${r.taskType} ${r.tier} ${r.provider}:${r.model} (admin отредактировал — не трогаем)`,
        );
        continue;
      }
      if (!updateExisting) {
        skipped++;
        // eslint-disable-next-line no-console
        console.log(`[skipped:exists] ${r.taskType} ${r.tier} ${r.provider}:${r.model}`);
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
      // eslint-disable-next-line no-console
      console.log(`[updated] ${r.taskType} ${r.tier} ${r.provider}:${r.model}`);
      continue;
    }
    await prisma.llmTaskRoute.create({
      data: {
        taskType: r.taskType,
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
    // eslint-disable-next-line no-console
    console.log(`[created] ${r.taskType} ${r.tier} ${r.provider}:${r.model}`);
  }

  // eslint-disable-next-line no-console
  console.log(
    `inserted: ${inserted}, updated: ${updated}, skipped(exists): ${skipped}, skipped(edited): ${skippedEdited}`,
  );
  // eslint-disable-next-line no-console
  console.log('=== seed-llm-task-routes-clone-v2 DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-clone-v2 FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
