/**
 * Прайс-карта моделей. Цены — USD за 1 млн токенов.
 * Источник: `c:\work\z\llm-models-playbook.md` §13 + публичные прайсы вендоров.
 *
 * Если модель отсутствует в карте — `calcCostUsd` вернёт 0, чтобы не падать
 * в проде на новой модели. Логирование делает `AiUsageLogService`.
 */
export interface ModelPrice {
  inputPer1M: number;
  outputPer1M: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  // Anthropic
  'claude-sonnet-4-6': { inputPer1M: 3, outputPer1M: 15 },
  'claude-opus-4-7': { inputPer1M: 15, outputPer1M: 75 },
  'claude-haiku-4-5-20251001': { inputPer1M: 1, outputPer1M: 5 },

  // OpenAI (через прокси)
  'gpt-5': { inputPer1M: 5, outputPer1M: 15 },
  'gpt-5-mini': { inputPer1M: 0.5, outputPer1M: 2 },
  'gpt-5-nano': { inputPer1M: 0.1, outputPer1M: 0.4 },
  'gpt-5.2': { inputPer1M: 5, outputPer1M: 15 },
  'gpt-5.4': { inputPer1M: 5, outputPer1M: 15 },
  'gpt-4.1': { inputPer1M: 2, outputPer1M: 8 },
  'gpt-4.1-mini': { inputPer1M: 0.4, outputPer1M: 1.6 },
  'gpt-4.1-nano': { inputPer1M: 0.1, outputPer1M: 0.4 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },

  // MiniMax (Anthropic-совместимый)
  'MiniMax-M2.5': { inputPer1M: 1.2, outputPer1M: 4.5 },
};

export function calcCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = MODEL_PRICES[model];
  if (!price) return 0;
  const cost =
    (inputTokens / 1_000_000) * price.inputPer1M +
    (outputTokens / 1_000_000) * price.outputPer1M;
  // Округление до 6 знаков, как в `AiUsageLog.costUsd Decimal(10, 6)`.
  return Math.round(cost * 1_000_000) / 1_000_000;
}
