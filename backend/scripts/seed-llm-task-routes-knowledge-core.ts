import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

interface ProviderEntry {
  provider: string;
  model?: string;
}

interface RouteSeed {
  taskType: string;
  providers: ProviderEntry[];
  isActive: boolean;
}

const COMMON_LEGACY: ProviderEntry[] = [
  { provider: 'deepseek', model: 'deepseek-v4-flash' },
  { provider: 'openai-via-proxy', model: 'gpt-5.4-mini' },
  { provider: 'ollama', model: 'qwen3:30b-a3b-instruct-2507' },
];

const ROUTES: RouteSeed[] = [
  { taskType: 'summary', providers: COMMON_LEGACY, isActive: true },
  { taskType: 'chapters', providers: COMMON_LEGACY, isActive: true },
  { taskType: 'tasks', providers: COMMON_LEGACY, isActive: true },
  { taskType: 'chat', providers: COMMON_LEGACY, isActive: true },
  { taskType: 'regenerate-section', providers: COMMON_LEGACY, isActive: true },
  { taskType: 'custom-prompt', providers: COMMON_LEGACY, isActive: true },
  { taskType: 'follow-up', providers: COMMON_LEGACY, isActive: true },
  { taskType: 'clip-title', providers: COMMON_LEGACY, isActive: true },
  { taskType: 'card-rollup', providers: COMMON_LEGACY, isActive: true },
  { taskType: 'card-chat', providers: COMMON_LEGACY, isActive: true },

  {
    taskType: 'block-ingest',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-pro' },
      { provider: 'openai-via-proxy', model: 'gpt-5.4' },
    ],
    isActive: true,
  },
  {
    taskType: 'block-distill',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-flash' },
      { provider: 'ollama', model: 'qwen3:30b-a3b-instruct-2507' },
      { provider: 'openai-via-proxy', model: 'gpt-5.4-nano' },
    ],
    isActive: true,
  },
  {
    taskType: 'meeting-skeleton',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-flash' },
      { provider: 'openai-via-proxy', model: 'gpt-5.4-nano' },
      { provider: 'kie', model: 'gemini-3.1-pro' },
    ],
    isActive: true,
  },
  {
    taskType: 'block-linker',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-flash' },
      { provider: 'openai-via-proxy', model: 'gpt-5.4-nano' },
    ],
    isActive: true,
  },
  {
    taskType: 'entity-resolver',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-flash' },
      { provider: 'openai-via-proxy', model: 'gpt-5.4-nano' },
    ],
    isActive: true,
  },
  {
    taskType: 'entity-merge-arbiter',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-flash' },
      { provider: 'openai-via-proxy', model: 'gpt-5.4-mini' },
    ],
    isActive: true,
  },
  {
    taskType: 'entity-graph-builder',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-flash' },
      { provider: 'openai-via-proxy', model: 'gpt-5.4-mini' },
    ],
    isActive: true,
  },
  {
    taskType: 'theme-classify',
    providers: [
      { provider: 'openai-via-proxy', model: 'gpt-5.4-nano' },
      { provider: 'deepseek', model: 'deepseek-v4-flash' },
    ],
    isActive: true,
  },
  {
    taskType: 'reframing',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-flash' },
      { provider: 'openai-via-proxy', model: 'gpt-5.4-mini' },
    ],
    isActive: true,
  },
  {
    taskType: 'card-rollup-v2',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-flash' },
      { provider: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { provider: 'ollama', model: 'qwen3:30b-a3b-instruct-2507' },
    ],
    isActive: true,
  },
  {
    taskType: 'task-extract-v2',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-flash' },
      { provider: 'openai-via-proxy', model: 'gpt-5.4-mini' },
    ],
    isActive: true,
  },
  {
    taskType: 'chapter-extract-v2',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-flash' },
      { provider: 'openai-via-proxy', model: 'gpt-5.4-mini' },
    ],
    isActive: true,
  },
  {
    taskType: 'summary-v2',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-pro' },
      { provider: 'openai-via-proxy', model: 'gpt-5.5' },
      { provider: 'minimax', model: 'MiniMax-M2.7' },
    ],
    isActive: true,
  },
  {
    taskType: 'chat-v2',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-pro' },
      { provider: 'openai-via-proxy', model: 'gpt-5.4' },
      { provider: 'kie', model: 'gemini-3.1-pro' },
    ],
    isActive: true,
  },
  {
    taskType: 'goal-alignment',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-pro' },
      { provider: 'openai-via-proxy', model: 'gpt-5.5' },
    ],
    isActive: true,
  },
  {
    taskType: 'dashboard-summary',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-flash' },
      { provider: 'openai-via-proxy', model: 'gpt-5.4-mini' },
    ],
    isActive: true,
  },
  {
    taskType: 'meeting-report-fast',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-pro' },
      { provider: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { provider: 'ollama', model: 'qwen3.5:9b' },
    ],
    isActive: true,
  },
];

async function main(): Promise<void> {
  const updateExisting = process.argv.includes('--update-existing');
  // eslint-disable-next-line no-console
  console.log(
    `=== seed-llm-task-routes-knowledge-core START (updateExisting=${updateExisting}) ===`,
  );

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

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
      // eslint-disable-next-line no-console
      console.log(`[created] ${route.taskType}`);
    } else if (updateExisting) {
      await prisma.llmTaskRoute.update({
        where: { id: existing.id },
        data: {
          providers: route.providers as unknown as object,
          isActive: route.isActive,
        },
      });
      updated++;
      // eslint-disable-next-line no-console
      console.log(`[updated] ${route.taskType}`);
    } else {
      skipped++;
      // eslint-disable-next-line no-console
      console.log(`[skipped] ${route.taskType}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`inserted: ${inserted}, updated: ${updated}, skipped: ${skipped}`);
  // eslint-disable-next-line no-console
  console.log('=== seed-llm-task-routes-knowledge-core DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-knowledge-core FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
