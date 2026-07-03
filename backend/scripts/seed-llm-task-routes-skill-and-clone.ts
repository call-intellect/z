import { PrismaClient, type LlmRouteTier } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

let prismaInstance: PrismaClient | null = null;
function getPrisma(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = createPrismaClient();
  }
  return prismaInstance;
}

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

const SEEDS: TaskRouteSeed[] = [
  {
    taskType: 'skill-trait-detect',
    playbookSection:
      '§2.3 capable LLM. Primary = deepseek-v4-pro выбрана через golden-прогон 2026-05-25 (24/25 vs gpt-5.4 23/25, в 4.5× дешевле). Перед сменой primary — обязательно прогнать `backend/test/eval/skill-trait-detect-golden/` с SKILL_TRAIT_DETECT_GOLDEN_REAL=1.',
    chain: [
      {
        tier: 'primary',
        providerName: 'deepseek',
        model: 'deepseek-v4-pro',
      },
      {
        tier: 'secondary',
        providerName: 'openai-via-proxy',
        model: 'gpt-5.4',
      },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3:30b' },
    ],
    pinnedVersionNote:
      'Закреплено на deepseek-v4-pro 2026-05-25 после golden-прогона (24/25 vs gpt-5.4 23/25, $0.02 vs $0.10). Перед сменой primary — обязательно прогнать SKILL_TRAIT_DETECT_GOLDEN_REAL=1 bunx vitest run backend/test/eval/skill-trait-detect-golden. Прокси DeepSeek не поддерживает версионные slug-и, поэтому при обновлении модели провайдером поведение может незаметно измениться.',
  },
  {
    taskType: 'skill-trait-merge',
    playbookSection: '§2.1 arbiter — JSON in/out, средняя сложность.',
    chain: [
      {
        tier: 'primary',
        providerName: 'deepseek',
        model: 'deepseek-v4-flash',
      },
      {
        tier: 'secondary',
        providerName: 'openai-via-proxy',
        model: 'gpt-5.4-mini',
      },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3:30b' },
    ],
  },
  {
    taskType: 'skill-trait-verify',
    playbookSection: '§2.1 grounding-верификатор черты — дешёвый JSON in/out.',
    chain: [
      {
        tier: 'primary',
        providerName: 'deepseek',
        model: 'deepseek-v4-flash',
      },
      {
        tier: 'secondary',
        providerName: 'openai-via-proxy',
        model: 'gpt-5.4-mini',
      },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3:30b' },
    ],
  },
  {
    taskType: 'executable-persona-compile',
    playbookSection:
      '§2.3 capable LLM — сборка всего клона (persona 300–800 слов из 7 слоёв). Primary = deepseek-v4-pro: flash спотыкался на structured/thinking (Thinking mode does not support tool_choice) и иногда обнулял клон при сборке. Compile редкий (раз на сборку клона), стоимость Pro оправдана надёжностью + качеством персоны.',
    chain: [
      {
        tier: 'primary',
        providerName: 'deepseek',
        model: 'deepseek-v4-pro',
      },
      {
        tier: 'secondary',
        providerName: 'openai-via-proxy',
        model: 'gpt-5.4',
      },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3:30b' },
    ],
  },
  {
    taskType: 'clone-respond',
    playbookSection: '§2.1 conversational с цитатами — близко к chat-v2 + custom prompt.',
    chain: [
      {
        tier: 'primary',
        providerName: 'deepseek',
        model: 'deepseek-v4-flash',
      },
      {
        tier: 'secondary',
        providerName: 'openai-via-proxy',
        model: 'gpt-5.4-mini',
      },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3:30b' },
    ],
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
    const existing = await getPrisma().llmTaskRoute.findFirst({
      where: {
        taskType: seed.taskType,
        tenantId: null,
        tier: entry.tier,
        providerName: entry.providerName,
      },
    });
    if (!existing) {
      await getPrisma().llmTaskRoute.create({
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
    await getPrisma().llmTaskRoute.update({
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
  console.log(
    `=== seed-llm-task-routes-skill-and-clone START (updateExisting=${updateExisting}) ===`,
  );
  // eslint-disable-next-line no-console
  console.log(`TaskTypes: ${SEEDS.map((s) => s.taskType).join(', ')}`);
  // eslint-disable-next-line no-console
  console.log(
    '⚠  skill-trait-detect — самая ответственная задача γ-1. Primary = deepseek-v4-pro (выбрана через golden-прогон 2026-05-25: 24/25 vs gpt-5.4 23/25, в 4.5× дешевле). pinnedVersionNote — см. seed. Перед сменой primary — golden-набор с SKILL_TRAIT_DETECT_GOLDEN_REAL=1.',
  );

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
  console.log('=== seed-llm-task-routes-skill-and-clone DONE ===');
}

declare const importMeta: { main?: boolean };
const isMain =
  typeof import.meta !== 'undefined' && (import.meta as unknown as importMeta).main === true;
if (isMain) {
  main()
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('seed-llm-task-routes-skill-and-clone FAILED:', err);
      process.exit(1);
    })
    .finally(async () => {
      if (prismaInstance) {
        await prismaInstance.$disconnect();
      }
    });
}

export { SEEDS };
