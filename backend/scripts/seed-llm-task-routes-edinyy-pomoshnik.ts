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
  agent: string;
  chain: TierEntry[];
}

const SEEDS: TaskRouteSeed[] = [
  {
    taskType: 'concierge-respond',
    agent: 'Мастер (диспетчер + действия + render) — надёжный tool-use',
    chain: [
      { tier: 'primary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'secondary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3.5:9b' },
    ],
  },
  {
    taskType: 'dialog-understand',
    agent: 'Понимание запроса — один короткий вызов определяет весь поиск',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-pro' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3.5:9b' },
    ],
  },
  {
    taskType: 'rag-rerank',
    agent: 'Переранжировщик — дёшево, ошибки мягкие',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3.5:9b' },
    ],
  },
  {
    taskType: 'chat-v2',
    agent: 'Синтез ответа — финальный текст человеку',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-pro' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'rag-groundedness',
    agent: 'Контролёр заземления — узкая бинарная проверка',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
    ],
  },
];

interface SeedStats {
  created: number;
  updated: number;
  skippedAdminEdited: number;
  unchanged: number;
}

async function applySeed(seed: TaskRouteSeed, stats: SeedStats): Promise<void> {
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
      stats.created++;

      console.log(
        `[создан] ${seed.taskType}/${entry.tier}/${entry.providerName}:${entry.model}`,
      );
      continue;
    }
    if (existing.editedByAdmin) {
      stats.skippedAdminEdited++;

      console.log(
        `[пропуск:правка-админа] ${seed.taskType}/${entry.tier}/${entry.providerName} (модель в БД: ${existing.model ?? 'null'})`,
      );
      continue;
    }
    if (
      existing.model === entry.model &&
      existing.priority === priority &&
      existing.isActive === true
    ) {
      stats.unchanged++;
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

    console.log(
      `[обновлён] ${seed.taskType}/${entry.tier}/${entry.providerName}:${entry.model}`,
    );
  }
}

async function main(): Promise<void> {

  console.log('=== seed-llm-task-routes-edinyy-pomoshnik START (авторитетный upsert) ===');

  console.log(`Агенты «Единый помощник»: ${SEEDS.map((s) => s.taskType).join(', ')}`);

  const stats: SeedStats = {
    created: 0,
    updated: 0,
    skippedAdminEdited: 0,
    unchanged: 0,
  };

  for (const seed of SEEDS) {
    await applySeed(seed, stats);
  }


  console.log(
    `created=${stats.created}, updated=${stats.updated}, skippedAdminEdited=${stats.skippedAdminEdited}, unchanged=${stats.unchanged}`,
  );

  console.log('=== seed-llm-task-routes-edinyy-pomoshnik DONE ===');
}

main()
  .catch((err) => {

    console.error('seed-llm-task-routes-edinyy-pomoshnik FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export { SEEDS };
