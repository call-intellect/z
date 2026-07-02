import { CryptoService } from '../src/common/crypto/crypto.service';

import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

function makeCfgStub(): { crypto: { masterKey: string } } {
  const raw = process.env['CRYPTO_MASTER_KEY'] ?? '';
  if (!raw) {
    throw new Error(
      'seed-embedding-providers: ENV CRYPTO_MASTER_KEY не задан. ' +
        'Шифровать ключи нечем — сначала пропиши ключ в .env.',
    );
  }
  return { crypto: { masterKey: raw } };
}

interface ModelSeed {
  modelKey: string;
  displayName: string;
  dimensions: number;
  isActive: boolean;
}

interface ProviderSeed {
  name: string;
  displayName: string;
  baseUrl: string;
  protocolKind: string;
  apiKeyEncrypted: string | null;
  isActive: boolean;
  priority: number;
  needsReindex: boolean;
  model: ModelSeed;
}

function stripEmbeddingsSuffix(url: string): string {
  return url.replace(/\/embeddings\/?$/, '');
}

function buildSeeds(crypto: CryptoService): ProviderSeed[] {
  const localBaseUrl = process.env['EMBEDDING_FALLBACK_LOCAL_URL'] ?? 'https://llm.korateam.ru/v1';
  const localApiKey = process.env['EMBEDDING_LOCAL_API_KEY'] ?? '';
  const embeddingModel = process.env['EMBEDDING_MODEL'] ?? 'embeddinggemma:latest';
  const embeddingDimensions = parseInt(process.env['EMBEDDING_DIMENSIONS'] ?? '768', 10);

  const proxyEmbeddingsUrl =
    process.env['OPENAI_PROXY_EMBEDDINGS_URL'] ?? 'https://proxy.agent-lia.ru/v1/embeddings';
  const proxyApiKey = process.env['OPENAI_PROXY_API_KEY'] ?? '';
  const proxyPrefix = process.env['PROXY_PREFIX'] ?? 'myFeedproxy3128';

  return [
    {
      name: 'local',
      displayName: 'Локальный (Ollama/llm.korateam.ru)',
      baseUrl: localBaseUrl,
      protocolKind: 'openai-embeddings',
      apiKeyEncrypted: localApiKey ? crypto.encrypt(localApiKey) : null,
      isActive: true,
      priority: 10,
      needsReindex: false,
      model: {
        modelKey: embeddingModel,
        displayName: embeddingModel,
        dimensions: embeddingDimensions,
        isActive: true,
      },
    },
    {
      name: 'openai-via-proxy',
      displayName: 'OpenAI через прокси',
      baseUrl: stripEmbeddingsSuffix(proxyEmbeddingsUrl),
      protocolKind: 'openai-embeddings',
      apiKeyEncrypted: proxyApiKey ? crypto.encrypt(`${proxyPrefix}:${proxyApiKey}`) : null,
      isActive: false,
      priority: 20,
      needsReindex: false,
      model: {
        modelKey: 'text-embedding-3-small',
        displayName: 'text-embedding-3-small',
        dimensions: 1536,
        isActive: true,
      },
    },
  ];
}

async function main(): Promise<void> {
  console.log('=== seed-embedding-providers START ===');

  const crypto = new CryptoService(makeCfgStub() as never);
  const seeds = buildSeeds(crypto);

  let created = 0;
  let skipped = 0;

  for (const seed of seeds) {
    const exists = await prisma.embeddingProvider.findUnique({ where: { name: seed.name } });
    if (exists) {
      skipped++;
      console.log(`skip ${seed.name}: уже существует (admin-правки не трогаем)`);
      continue;
    }
    await prisma.embeddingProvider.create({
      data: {
        name: seed.name,
        displayName: seed.displayName,
        baseUrl: seed.baseUrl,
        protocolKind: seed.protocolKind,
        apiKeyEncrypted: seed.apiKeyEncrypted,
        isActive: seed.isActive,
        priority: seed.priority,
        needsReindex: seed.needsReindex,
        models: {
          create: [
            {
              modelKey: seed.model.modelKey,
              displayName: seed.model.displayName,
              dimensions: seed.model.dimensions,
              isActive: seed.model.isActive,
            },
          ],
        },
      },
    });
    created++;
    console.log(
      `create ${seed.name}: active=${seed.isActive} priority=${seed.priority} ` +
        `model=${seed.model.modelKey}(${seed.model.dimensions}) key=${seed.apiKeyEncrypted ? 'encrypted' : 'null'}`,
    );
  }

  console.log(`providers: создано=${created}, пропущено=${skipped}`);
  console.log('=== seed-embedding-providers DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-embedding-providers FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
