import { Prisma, PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

import { MODEL_PRICES } from '../src/modules/ai/services/model-prices';

const prisma = createPrismaClient();

function detectProvider(model: string): string {
  if (model.startsWith('deepseek-')) return 'deepseek';
  if (model.startsWith('gpt-') || model.startsWith('text-embedding-')) return 'openai';
  if (model.startsWith('claude-')) return 'anthropic';
  if (model.startsWith('MiniMax-')) return 'minimax';
  if (model.startsWith('bge-') || model.startsWith('qwen')) return 'ollama';
  if (model.startsWith('gemini-')) return 'gemini-grsai';
  return 'unknown';
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('=== seed-llm-model-prices START ===');

  let inserted = 0;
  let skipped = 0;

  for (const [model, price] of Object.entries(MODEL_PRICES)) {
    const provider = detectProvider(model);
    if (provider === 'unknown') {
      // eslint-disable-next-line no-console
      console.warn(`Пропускаю ${model}: не удалось определить provider`);
      continue;
    }

    const existing = await prisma.llmModelPrice.findFirst({
      where: { provider, model, effectiveTo: null },
    });
    if (existing) {
      skipped++;
      continue;
    }

    await prisma.llmModelPrice.create({
      data: {
        provider,
        model,
        inputCostPerMillionTokens: new Prisma.Decimal(price.inputPer1M.toFixed(6)),
        outputCostPerMillionTokens: new Prisma.Decimal(price.outputPer1M.toFixed(6)),
        cachedCostPerMillionTokens: new Prisma.Decimal((price.cachedPer1M ?? 0).toFixed(6)),
        currency: 'USD',
      },
    });
    inserted++;
  }

  // eslint-disable-next-line no-console
  console.log(`inserted: ${inserted}, skipped (already active): ${skipped}`);
  // eslint-disable-next-line no-console
  console.log('=== seed-llm-model-prices DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-model-prices FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
