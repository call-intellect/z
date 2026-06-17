import { type LlmRouteTier } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

interface TierEntry {
  tier: LlmRouteTier;
  providerName: string;
  model: string;
}

interface TaskRouteSeed {
  taskType: string;
  playbookSection: string;
  chain: TierEntry[];
  pinnedVersionNote?: string;
}

const CHEAP_CHAIN: TierEntry[] = [
  { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
  { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
  { tier: 'tertiary', providerName: 'ollama', model: 'qwen3.5:9b' },
];

const PIN = 'Закреплено 2026-06-02 для Action Center A1 (curation-verify)';

const SEEDS: TaskRouteSeed[] = [
  {
    taskType: 'debate-curation-verify',
    playbookSection:
      '§2.1 короткий JSON-вердикт. Зонтичный route для агрегатной аналитики стоимости debate-сессии canonical-verify. Реальные вызовы — через 3 stance-taskType ниже. Cheap-цепочка.',
    chain: CHEAP_CHAIN,
    pinnedVersionNote: PIN,
  },
  {
    taskType: 'debate-curation-verify-critic',
    playbookSection:
      'Curation-Verify stance "strict-critic". Бинарный вердикт accept|reject по готовому payload карточки. Cheap: primary = deepseek-v4-flash.',
    chain: CHEAP_CHAIN,
    pinnedVersionNote: PIN,
  },
  {
    taskType: 'debate-curation-verify-supporter',
    playbookSection:
      'Curation-Verify stance "empathetic-supporter". Primary = openai-via-proxy/gpt-5.4-mini (diverse провайдер для diversity голосов).',
    chain: [
      { tier: 'primary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'secondary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3.5:9b' },
    ],
    pinnedVersionNote: PIN,
  },
  {
    taskType: 'debate-curation-verify-neutral',
    playbookSection:
      'Curation-Verify stance "neutral-judge". Cheap арбитр: primary = deepseek-v4-flash.',
    chain: CHEAP_CHAIN,
    pinnedVersionNote: PIN,
  },
];

interface SeedStats {
  inserted: number;
  updated: number;
  skipped: number;
  protectedByAudit: number;
}

async function applySeed(
  seed: TaskRouteSeed,
  updateExisting: boolean,
  stats: SeedStats,
): Promise<void> {
  for (let i = 0; i < seed.chain.length; i++) {
    const entry = seed.chain[i];
    if (!entry) continue;
    const priority = i;
    const existing = await prisma.llmTaskRoute.findFirst({
      where: {
        taskType: seed.taskType,
        tenantId: null,
        tier: entry.tier,
        providerName: entry.providerName,
      },
    });
    if (!existing) {
      await prisma.llmTaskRoute.create({
        data: {
          taskType: seed.taskType,
          tenantId: null,
          tier: entry.tier,
          providerName: entry.providerName,
          model: entry.model,
          priority,
          providers: null,
          isActive: true,
          editedByAdmin: false,
          pinnedVersionNote: seed.pinnedVersionNote ?? null,
        },
      });
      stats.inserted++;
      // eslint-disable-next-line no-console
      console.log(`[insert] ${seed.taskType}/${entry.tier}/${entry.providerName}:${entry.model}`);
      continue;
    }
    if (existing.editedByAdmin) {
      stats.protectedByAudit++;
      // eslint-disable-next-line no-console
      console.log(`[skip:edited-by-admin] ${seed.taskType}/${entry.tier}/${entry.providerName}`);
      continue;
    }
    if (!updateExisting) {
      stats.skipped++;
      continue;
    }
    const seedPin = seed.pinnedVersionNote ?? null;
    if (
      existing.model === entry.model &&
      existing.priority === priority &&
      existing.isActive === true &&
      existing.pinnedVersionNote === seedPin
    ) {
      stats.skipped++;
      continue;
    }
    await prisma.llmTaskRoute.update({
      where: { id: existing.id },
      data: {
        model: entry.model,
        priority,
        isActive: true,
        pinnedVersionNote: seedPin,
      },
    });
    stats.updated++;
    // eslint-disable-next-line no-console
    console.log(`[update] ${seed.taskType}/${entry.tier}/${entry.providerName}:${entry.model}`);
  }
}

async function main(): Promise<void> {
  const updateExisting = process.argv.includes('--update-existing');
  // eslint-disable-next-line no-console
  console.log(`=== seed-llm-task-routes-curation START (updateExisting=${updateExisting}) ===`);
  // eslint-disable-next-line no-console
  console.log(`TaskTypes: ${SEEDS.map((s) => s.taskType).join(', ')}`);

  const stats: SeedStats = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    protectedByAudit: 0,
  };

  for (const seed of SEEDS) {
    await applySeed(seed, updateExisting, stats);
  }

  // eslint-disable-next-line no-console
  console.log(
    `inserted=${stats.inserted}, updated=${stats.updated}, skipped=${stats.skipped}, protected_by_admin=${stats.protectedByAudit}`,
  );
  // eslint-disable-next-line no-console
  console.log('=== seed-llm-task-routes-curation DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-curation FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export { SEEDS };
