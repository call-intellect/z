import { PrismaClient, type LlmRouteTier } from '@prisma/client';
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
}

const COMMON_TASK_CHAIN: TierEntry[] = [
  { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
  {
    tier: 'secondary',
    providerName: 'openai-via-proxy',
    model: 'gpt-4o-mini',
  },
  { tier: 'tertiary', providerName: 'ollama', model: 'qwen3.5:9b' },
];

const SEEDS: TaskRouteSeed[] = [
  {
    taskType: 'telegram-create-task',
    playbookSection:
      '§4.1 Telegram-бот для задач — парсер «одной фразы». Strict JSON Schema. Capable модель.',
    chain: COMMON_TASK_CHAIN,
  },
  {
    taskType: 'telegram-forward-to-task',
    playbookSection:
      '§4.2 Telegram forward → task. Тот же контракт извлечения, но входной текст шумнее.',
    chain: COMMON_TASK_CHAIN,
  },
  {
    taskType: 'telegram-reply-classify',
    playbookSection:
      '§4.3 Telegram reply-classify (status_command/comment/new_task). Дёшево, быстро — primary ollama.',
    chain: [
      { tier: 'primary', providerName: 'ollama', model: 'qwen3.5:9b' },
      {
        tier: 'secondary',
        providerName: 'deepseek',
        model: 'deepseek-v4-flash',
      },
      {
        tier: 'tertiary',
        providerName: 'openai-via-proxy',
        model: 'gpt-4o-mini',
      },
    ],
  },
  {
    taskType: 'telegram-digest-formulate',
    playbookSection:
      '§4.5 Telegram digest — короткий markdown/HTML; не требует JSON Schema. Capable модель.',
    chain: COMMON_TASK_CHAIN,
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
    if (
      existing.model === entry.model &&
      existing.priority === priority &&
      existing.isActive === true
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
  console.log(
    `=== seed-llm-task-routes-tracker-phase4-telegram START (updateExisting=${updateExisting}) ===`,
  );
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
  console.log('=== seed-llm-task-routes-tracker-phase4-telegram DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-tracker-phase4-telegram FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export { SEEDS };
