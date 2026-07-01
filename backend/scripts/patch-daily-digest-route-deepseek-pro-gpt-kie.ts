import { type LlmRouteTier } from '@prisma/client';

import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

const TASK_TYPE = 'operations-daily-digest';

interface TierEntry {
  tier: LlmRouteTier;
  providerName: string;
  model: string;
  priority: number;
}

const CHAIN: TierEntry[] = [
  { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-pro', priority: 0 },
  { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini', priority: 0 },
  { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro', priority: 0 },
];

interface Stats {
  created: number;
  updated: number;
  unchanged: number;
  skippedEdited: number;
  deactivated: number;
}

async function upsertTier(entry: TierEntry, stats: Stats): Promise<void> {
  const existing = await prisma.llmTaskRoute.findFirst({
    where: {
      taskType: TASK_TYPE,
      tenantId: null,
      tier: entry.tier,
      providerName: entry.providerName,
    },
  });

  if (!existing) {
    await prisma.llmTaskRoute.create({
      data: {
        taskType: TASK_TYPE,
        tenantId: null,
        tier: entry.tier,
        providerName: entry.providerName,
        model: entry.model,
        priority: entry.priority,
        providers: null,
        isActive: true,
        editedByAdmin: false,
      },
    });
    stats.created++;

    console.log(`[create] ${TASK_TYPE}/${entry.tier}/${entry.providerName}:${entry.model}`);
    return;
  }

  if (existing.editedByAdmin) {
    stats.skippedEdited++;

    console.log(`[skip:edited-by-admin] ${TASK_TYPE}/${entry.tier}/${entry.providerName}`);
    return;
  }

  if (
    existing.model === entry.model &&
    existing.priority === entry.priority &&
    existing.isActive === true
  ) {
    stats.unchanged++;

    console.log(`[unchanged] ${TASK_TYPE}/${entry.tier}/${entry.providerName}:${entry.model}`);
    return;
  }

  await prisma.llmTaskRoute.update({
    where: { id: existing.id },
    data: {
      model: entry.model,
      priority: entry.priority,
      isActive: true,
    },
  });
  stats.updated++;

  console.log(`[update] ${TASK_TYPE}/${entry.tier}/${entry.providerName}:${entry.model}`);
}

async function deactivateStaleProviders(stats: Stats): Promise<void> {
  const keep = new Set(CHAIN.map((e) => `${e.tier}:${e.providerName}`));
  const rows = await prisma.llmTaskRoute.findMany({
    where: { taskType: TASK_TYPE, tenantId: null, tier: { not: null } },
  });

  for (const row of rows) {
    if (!row.tier || !row.providerName) continue;
    if (keep.has(`${row.tier}:${row.providerName}`)) continue;
    if (row.editedByAdmin) {
      stats.skippedEdited++;

      console.log(`[skip:edited-by-admin] stale ${TASK_TYPE}/${row.tier}/${row.providerName}`);
      continue;
    }
    if (!row.isActive) {
      stats.unchanged++;

      console.log(`[unchanged] stale-inactive ${TASK_TYPE}/${row.tier}/${row.providerName}`);
      continue;
    }
    await prisma.llmTaskRoute.update({
      where: { id: row.id },
      data: { isActive: false },
    });
    stats.deactivated++;

    console.log(`[deactivate] stale ${TASK_TYPE}/${row.tier}/${row.providerName}:${row.model}`);
  }
}

async function main(): Promise<void> {
  console.log('=== patch-daily-digest-route-deepseek-pro-gpt-kie START ===');

  const stats: Stats = {
    created: 0,
    updated: 0,
    unchanged: 0,
    skippedEdited: 0,
    deactivated: 0,
  };

  for (const entry of CHAIN) {
    await upsertTier(entry, stats);
  }
  await deactivateStaleProviders(stats);

  console.log(
    `created=${stats.created}, updated=${stats.updated}, unchanged=${stats.unchanged}, ` +
      `deactivated=${stats.deactivated}, skipped_edited=${stats.skippedEdited}`,
  );

  console.log('=== patch-daily-digest-route-deepseek-pro-gpt-kie DONE ===');
}

main()
  .catch((err) => {
    console.error('patch-daily-digest-route-deepseek-pro-gpt-kie FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
