import type { LlmRouteTier } from '@prisma/client';

import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

const TASK_TYPE = 'meeting-report-fast';

interface FallbackRow {
  tier: LlmRouteTier;
  providerName: string;
  model: string;
}

const FALLBACK_ROWS: FallbackRow[] = [
  { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
  { tier: 'tertiary', providerName: 'ollama', model: 'qwen3.5:9b' },
];

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  console.log(`=== patch-ensure-meeting-report-fast-fallback START (dryRun=${dryRun}) ===`);

  const primary = await prisma.llmTaskRoute.findFirst({
    where: { taskType: TASK_TYPE, tenantId: null, tier: 'primary' },
  });

  if (!primary) {
    console.log(
      `[noop] нет нормализованной primary-строки для ${TASK_TYPE} — legacy providers JSON работает как есть, патч не нужен.`,
    );
    return;
  }

  let inserted = 0;
  let skipped = 0;

  for (const row of FALLBACK_ROWS) {
    const existing = await prisma.llmTaskRoute.findFirst({
      where: { taskType: TASK_TYPE, tenantId: null, tier: row.tier },
    });
    if (existing) {
      skipped++;

      console.log(
        `[skip] ${TASK_TYPE}/${row.tier} уже есть (${existing.providerName}:${existing.model})`,
      );
      continue;
    }
    if (dryRun) {
      console.log(`[would-insert] ${TASK_TYPE}/${row.tier}/${row.providerName}:${row.model}`);
      inserted++;
      continue;
    }
    await prisma.llmTaskRoute.create({
      data: {
        taskType: TASK_TYPE,
        tenantId: null,
        tier: row.tier,
        providerName: row.providerName,
        model: row.model,
        priority: 0,
        providers: null,
        isActive: true,
        editedByAdmin: false,
      },
    });
    inserted++;

    console.log(`[insert] ${TASK_TYPE}/${row.tier}/${row.providerName}:${row.model}`);
  }

  console.log(`inserted=${inserted}, skipped=${skipped}`);

  console.log('=== patch-ensure-meeting-report-fast-fallback DONE ===');
}

main()
  .catch((err) => {
    console.error('patch-ensure-meeting-report-fast-fallback FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
