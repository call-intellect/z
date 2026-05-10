/**
 * Seed для таблицы LlmModelPrice.
 *
 * Источник правды (fallback): backend/src/modules/ai/services/model-prices.ts.
 * Этот скрипт переносит все известные модели в БД-таблицу с effectiveFrom=now,
 * effectiveTo=NULL.
 *
 * Идемпотентность: для каждой модели проверяем, есть ли уже запись с
 * (provider, model, effectiveTo IS NULL). Если есть — пропускаем (не дублируем).
 * Чтобы обновить цену — нужно сначала закрыть старую (effectiveTo=now),
 * потом запустить скрипт повторно с новыми ценами в коде. Это намеренно:
 * прайс-карта версионируется, ретроспективные расчёты должны быть точны.
 *
 * Запуск:
 *   bun run scripts/seed-llm-model-prices.ts
 */

import { Prisma, PrismaClient } from '@prisma/client';

import { MODEL_PRICES } from '../src/modules/ai/services/model-prices';

const prisma = new PrismaClient();

/**
 * Определяем provider по префиксу model name.
 * Согласно ТЗ Фазы 0 ("Шаг 1, пункт 10").
 */
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

    // Идемпотентность: ищем активную запись (effectiveTo IS NULL).
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
        cachedCostPerMillionTokens: new Prisma.Decimal(
          (price.cachedPer1M ?? 0).toFixed(6),
        ),
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
