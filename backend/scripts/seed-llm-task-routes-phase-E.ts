import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

const TASK_TYPE = 'custom-report' as const;

interface RouteSeed {
  tier: 'primary' | 'secondary' | 'tertiary';
  provider: string;
  model: string;
  priority: number;
  maxDataClass: 'public' | 'internal' | 'sensitive' | 'private';
}

const ROUTES: RouteSeed[] = [
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

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`=== seed-llm-task-routes-phase-E START (taskType=${TASK_TYPE}) ===`);

  let inserted = 0;
  let skipped = 0;
  let skippedEdited = 0;

  for (const r of ROUTES) {
    const existing = await prisma.llmTaskRoute.findFirst({
      where: {
        taskType: TASK_TYPE,
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
          `[skipped:edited] ${r.tier} ${r.provider}:${r.model} (admin отредактировал — не трогаем)`,
        );
      } else {
        skipped++;
        // eslint-disable-next-line no-console
        console.log(`[skipped:exists] ${r.tier} ${r.provider}:${r.model}`);
      }
      continue;
    }
    await prisma.llmTaskRoute.create({
      data: {
        taskType: TASK_TYPE,
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
    console.log(`[created] ${r.tier} ${r.provider}:${r.model}`);
  }

  // eslint-disable-next-line no-console
  console.log(
    `inserted: ${inserted}, skipped(exists): ${skipped}, skipped(edited): ${skippedEdited}`,
  );
  // eslint-disable-next-line no-console
  console.log('=== seed-llm-task-routes-phase-E DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-phase-E FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
