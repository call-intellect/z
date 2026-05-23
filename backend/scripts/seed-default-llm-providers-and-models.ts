/**
 * SBA α-10 wave 3 — Seed для LlmProvider + LlmModel (default-набор).
 *
 * Safe-seed-rules (см. docs skill `safe-seed-rules`):
 *   - НЕ перезаписывает уже существующие записи (lookup по unique key).
 *   - Защищает admin-edited (заметку «admin edited» trackim через updatedAt
 *     != createdAt — на wave 3 проверяем по факту существования; в гамма-фазе
 *     заведём отдельный флаг `seedManagedBy`).
 *   - apiKeyEncrypted НИКОГДА не пишется из seed'а — оставляем NULL,
 *     админ заводит ключ через UI (`/admin/llm/providers/[id]`).
 *
 * Запуск:
 *   bun run scripts/seed-default-llm-providers-and-models.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ProviderSeed {
  name: string;
  displayName: string;
  baseUrl: string;
  protocolKind:
    | 'openai-chat'
    | 'openai-responses'
    | 'anthropic-messages'
    | 'ollama-native'
    | 'custom-http';
  capability: 'public' | 'internal' | 'sensitive' | 'private';
  defaultHeaders?: Record<string, string>;
}

const PROVIDERS: ProviderSeed[] = [
  {
    name: 'openai-via-proxy',
    displayName: 'OpenAI (через proxy.agent-lia.ru)',
    baseUrl: 'https://proxy.agent-lia.ru/v1',
    protocolKind: 'openai-responses',
    capability: 'internal',
  },
  {
    name: 'deepseek',
    displayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    protocolKind: 'openai-chat',
    capability: 'internal',
  },
  {
    name: 'anthropic',
    displayName: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com',
    protocolKind: 'anthropic-messages',
    capability: 'sensitive',
    defaultHeaders: { 'anthropic-version': '2023-06-01' },
  },
  {
    name: 'ollama',
    displayName: 'Ollama (self-hosted)',
    baseUrl: 'https://ollama.agent-lia.ru/v1',
    protocolKind: 'ollama-native',
    capability: 'private',
  },
  {
    name: 'minimax',
    displayName: 'MiniMax (Anthropic-compat)',
    baseUrl: 'https://api.minimax.io/anthropic',
    protocolKind: 'anthropic-messages',
    capability: 'internal',
  },
];

interface ModelSeed {
  providerName: string;
  modelKey: string;
  displayName: string;
  contextWindow?: number;
  category: 'flagship' | 'fast' | 'reasoning' | 'embedding' | 'experimental';
  notes?: string;
}

const MODELS: ModelSeed[] = [
  {
    providerName: 'openai-via-proxy',
    modelKey: 'gpt-4o',
    displayName: 'GPT-4o',
    contextWindow: 128_000,
    category: 'flagship',
  },
  {
    providerName: 'openai-via-proxy',
    modelKey: 'gpt-4o-mini',
    displayName: 'GPT-4o mini',
    contextWindow: 128_000,
    category: 'fast',
  },
  {
    providerName: 'deepseek',
    modelKey: 'deepseek-chat',
    displayName: 'DeepSeek Chat',
    contextWindow: 64_000,
    category: 'fast',
  },
  {
    providerName: 'ollama',
    modelKey: 'qwen3.5:9b',
    displayName: 'Qwen 3.5 9B (Ollama)',
    contextWindow: 32_000,
    category: 'fast',
    notes: 'Локальная модель — для private dataClass.',
  },
  {
    providerName: 'anthropic',
    modelKey: 'claude-sonnet-4-6',
    displayName: 'Claude Sonnet 4.6',
    contextWindow: 200_000,
    category: 'flagship',
  },
  {
    providerName: 'anthropic',
    modelKey: 'claude-opus-4-7',
    displayName: 'Claude Opus 4.7',
    contextWindow: 200_000,
    category: 'reasoning',
  },
];

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('=== seed-default-llm-providers-and-models START ===');

  let providersInserted = 0;
  let providersSkipped = 0;
  let modelsInserted = 0;
  let modelsSkipped = 0;

  // 1. Providers — по unique `name`.
  for (const p of PROVIDERS) {
    const exists = await prisma.llmProvider.findUnique({
      where: { name: p.name },
    });
    if (exists) {
      providersSkipped++;
      continue;
    }
    await prisma.llmProvider.create({
      data: {
        name: p.name,
        displayName: p.displayName,
        baseUrl: p.baseUrl,
        protocolKind: p.protocolKind,
        capability: p.capability,
        isActive: true,
        ...(p.defaultHeaders ? { defaultHeaders: p.defaultHeaders } : {}),
      },
    });
    providersInserted++;
  }

  // 2. Models — по unique (providerId, modelKey).
  for (const m of MODELS) {
    const provider = await prisma.llmProvider.findUnique({
      where: { name: m.providerName },
    });
    if (!provider) {
      // eslint-disable-next-line no-console
      console.warn(
        `Пропускаю модель ${m.modelKey}: provider ${m.providerName} не найден`,
      );
      continue;
    }
    const exists = await prisma.llmModel.findFirst({
      where: { providerId: provider.id, modelKey: m.modelKey },
    });
    if (exists) {
      modelsSkipped++;
      continue;
    }
    await prisma.llmModel.create({
      data: {
        providerId: provider.id,
        modelKey: m.modelKey,
        displayName: m.displayName,
        ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
        category: m.category,
        isActive: true,
        ...(m.notes ? { notes: m.notes } : {}),
      },
    });
    modelsInserted++;
  }

  // eslint-disable-next-line no-console
  console.log(
    `providers: inserted=${providersInserted}, skipped=${providersSkipped}; ` +
      `models: inserted=${modelsInserted}, skipped=${modelsSkipped}`,
  );
  // eslint-disable-next-line no-console
  console.log('=== seed-default-llm-providers-and-models DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-default-llm-providers-and-models FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
