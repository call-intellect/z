import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }),
});

interface ProviderSeed {
  name: string;
  displayName: string;
  baseUrl: string;
  protocolKind:
    | 'openai-chat'
    | 'openai-responses'
    | 'anthropic-messages'
    | 'ollama-native'
    | 'kie-native'
    | 'grsai-native'
    | 'custom-http';
  capability: 'public' | 'internal' | 'sensitive' | 'private';
  defaultHeaders?: Record<string, string>;
  useProxy?: boolean;
  proxyPath?: string;
  defaultModelKey?: string;
  timeoutMs?: number;
}

const PROVIDERS: ProviderSeed[] = [
  {
    name: 'openai-via-proxy',
    displayName: 'OpenAI (через proxy.agent-lia.ru)',
    baseUrl: 'https://proxy.agent-lia.ru/v1',
    protocolKind: 'openai-responses',
    capability: 'internal',
    useProxy: true,
    defaultModelKey: 'gpt-5-mini',
  },
  {
    name: 'deepseek',
    displayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    protocolKind: 'openai-chat',
    capability: 'internal',
    defaultModelKey: 'deepseek-v4-flash',
  },
  {
    name: 'anthropic',
    displayName: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com',
    protocolKind: 'anthropic-messages',
    capability: 'sensitive',
    defaultHeaders: { 'anthropic-version': '2023-06-01' },
    defaultModelKey: 'claude-sonnet-4-6',
  },
  {
    name: 'ollama',
    displayName: 'Ollama (self-hosted)',
    baseUrl: 'https://ollama.agent-lia.ru/v1',
    protocolKind: 'ollama-native',
    capability: 'private',
    defaultModelKey: 'qwen3:30b-a3b-instruct-2507',
  },
  {
    name: 'minimax',
    displayName: 'MiniMax (Anthropic-compat)',
    baseUrl: 'https://api.minimax.io/anthropic',
    protocolKind: 'anthropic-messages',
    capability: 'internal',
    defaultModelKey: 'MiniMax-M2.5',
  },
  {
    name: 'kie',
    displayName: 'KIE (api.kie.ai — Claude/GPT/Gemini hub)',
    baseUrl: 'https://api.kie.ai',
    protocolKind: 'kie-native',
    capability: 'internal',
    defaultModelKey: 'gemini-3.1-pro',
    timeoutMs: 180_000,
  },
  {
    name: 'grsai',
    displayName: 'GRSAI (Gemini через proxy.agent-lia.ru)',
    baseUrl: 'https://grsaiapi.com',
    protocolKind: 'grsai-native',
    capability: 'internal',
    useProxy: true,
    proxyPath: 'grsai',
    defaultModelKey: 'gemini-3.1-pro',
  },
];

interface ModelSeed {
  providerName: string;
  modelKey: string;
  displayName: string;
  contextWindow?: number;
  category: 'flagship' | 'fast' | 'reasoning' | 'embedding' | 'experimental';
  notes?: string;
  isActive?: boolean;
}

const MODELS: ModelSeed[] = [
  {
    providerName: 'openai-via-proxy',
    modelKey: 'gpt-4o',
    displayName: 'GPT-4o',
    contextWindow: 128_000,
    category: 'flagship',
    isActive: false,
  },
  {
    providerName: 'openai-via-proxy',
    modelKey: 'gpt-4o-mini',
    displayName: 'GPT-4o mini',
    contextWindow: 128_000,
    category: 'fast',
    isActive: false,
  },
  {
    providerName: 'openai-via-proxy',
    modelKey: 'gpt-5-mini',
    displayName: 'GPT-5 mini',
    contextWindow: 200_000,
    category: 'fast',
    notes: 'Дефолт-модель OpenAI-через-прокси.',
  },
  {
    providerName: 'deepseek',
    modelKey: 'deepseek-chat',
    displayName: 'DeepSeek Chat',
    contextWindow: 64_000,
    category: 'fast',
    isActive: false,
  },
  {
    providerName: 'deepseek',
    modelKey: 'deepseek-v4-flash',
    displayName: 'DeepSeek V4 Flash',
    contextWindow: 64_000,
    category: 'fast',
    notes: 'Дефолт-модель DeepSeek (DEEPSEEK_DEFAULT_MODEL).',
  },
  {
    providerName: 'deepseek',
    modelKey: 'deepseek-v4-pro',
    displayName: 'DeepSeek V4 Pro',
    contextWindow: 64_000,
    category: 'reasoning',
  },
  {
    providerName: 'ollama',
    modelKey: 'qwen3.5:9b',
    displayName: 'Qwen 3.5 9B (Ollama)',
    contextWindow: 32_000,
    category: 'fast',
    notes: 'Локальная модель — для private dataClass.',
    isActive: false,
  },
  {
    providerName: 'ollama',
    modelKey: 'qwen3:30b-a3b-instruct-2507',
    displayName: 'Qwen3 30B A3B Instruct (Ollama)',
    contextWindow: 32_000,
    category: 'fast',
    notes: 'Дефолт-модель Ollama (self-hosted, private dataClass).',
  },
  {
    providerName: 'minimax',
    modelKey: 'MiniMax-M2.5',
    displayName: 'MiniMax M2.5',
    contextWindow: 200_000,
    category: 'flagship',
    notes: 'Дефолт-модель MiniMax.',
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
  {
    providerName: 'kie',
    modelKey: 'claude-opus-4-7',
    displayName: 'Claude Opus 4.7 (через KIE)',
    contextWindow: 200_000,
    category: 'reasoning',
    notes: 'KIE Claude-format → /claude/v1/messages.',
  },
  {
    providerName: 'kie',
    modelKey: 'gpt-5.4',
    displayName: 'GPT-5.4 (через KIE)',
    contextWindow: 200_000,
    category: 'flagship',
    notes: 'KIE GPT-format → /codex/v1/responses (OpenAI Responses-style). Цена TBD.',
  },
  {
    providerName: 'kie',
    modelKey: 'gemini-3-pro',
    displayName: 'Gemini 3 Pro (через KIE)',
    contextWindow: 1_000_000,
    category: 'flagship',
    notes: 'KIE Gemini-format → /${model}/v1/chat/completions.',
  },
  {
    providerName: 'kie',
    modelKey: 'gemini-3.1-pro',
    displayName: 'Gemini 3.1 Pro (через KIE)',
    contextWindow: 1_000_000,
    category: 'flagship',
    notes: 'KIE Gemini-format → /${model}/v1/chat/completions.',
  },
  {
    providerName: 'kie',
    modelKey: 'gemini-3-flash',
    displayName: 'Gemini 3 Flash (через KIE)',
    contextWindow: 1_000_000,
    category: 'fast',
    notes:
      'KIE Gemini-format → /${model}/v1/chat/completions. Кандидат на A/B с deepseek-v4-flash. Цена TBD.',
  },
  {
    providerName: 'grsai',
    modelKey: 'gemini-3-pro',
    displayName: 'Gemini 3 Pro (через GRSAI)',
    contextWindow: 1_000_000,
    category: 'flagship',
    notes: 'GRSAI SSE через proxy.agent-lia.ru/grsai/v1/chat/completions.',
  },
  {
    providerName: 'grsai',
    modelKey: 'gemini-3.1-pro',
    displayName: 'Gemini 3.1 Pro (через GRSAI)',
    contextWindow: 1_000_000,
    category: 'flagship',
    notes: 'GRSAI SSE через proxy.agent-lia.ru/grsai/v1/chat/completions.',
  },
];

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('=== seed-default-llm-providers-and-models START ===');

  let providersInserted = 0;
  let providersSkipped = 0;
  let modelsInserted = 0;
  let modelsSkipped = 0;

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
        ...(p.useProxy !== undefined ? { useProxy: p.useProxy } : {}),
        ...(p.proxyPath ? { proxyPath: p.proxyPath } : {}),
        ...(p.defaultModelKey ? { defaultModelKey: p.defaultModelKey } : {}),
        ...(p.timeoutMs ? { timeoutMs: p.timeoutMs } : {}),
      },
    });
    providersInserted++;
  }

  for (const m of MODELS) {
    const provider = await prisma.llmProvider.findUnique({
      where: { name: m.providerName },
    });
    if (!provider) {
      // eslint-disable-next-line no-console
      console.warn(`Пропускаю модель ${m.modelKey}: provider ${m.providerName} не найден`);
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
        isActive: m.isActive ?? true,
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
