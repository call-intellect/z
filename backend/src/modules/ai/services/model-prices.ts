export interface ModelPrice {
  inputPer1M: number;
  outputPer1M: number;
  cachedPer1M?: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  'deepseek-v4-pro': { inputPer1M: 1.74, outputPer1M: 3.48, cachedPer1M: 0.174 },
  'deepseek-v4-flash': { inputPer1M: 0.14, outputPer1M: 0.28, cachedPer1M: 0.014 },
  'deepseek-v3.2': { inputPer1M: 0.28, outputPer1M: 0.42, cachedPer1M: 0.028 },
  'deepseek-reasoner': { inputPer1M: 0.28, outputPer1M: 0.42 },
  'deepseek-chat': { inputPer1M: 0.14, outputPer1M: 0.28 },

  'gpt-5.5': { inputPer1M: 5, outputPer1M: 30, cachedPer1M: 0.5 },
  'gpt-5.5-pro': { inputPer1M: 30, outputPer1M: 180 },
  'gpt-5.4': { inputPer1M: 2, outputPer1M: 10, cachedPer1M: 0.2 },
  'gpt-5.4-mini': { inputPer1M: 0.75, outputPer1M: 4.5, cachedPer1M: 0.075 },
  'gpt-5.4-nano': { inputPer1M: 0.2, outputPer1M: 1.25, cachedPer1M: 0.02 },
  'gpt-5': { inputPer1M: 1.25, outputPer1M: 10, cachedPer1M: 0.125 },
  'gpt-5-mini': { inputPer1M: 0.25, outputPer1M: 2, cachedPer1M: 0.025 },
  'gpt-5-nano': { inputPer1M: 0.05, outputPer1M: 0.4, cachedPer1M: 0.005 },
  'gpt-5.2': { inputPer1M: 1.75, outputPer1M: 14, cachedPer1M: 0.175 },
  'gpt-4.1': { inputPer1M: 2, outputPer1M: 8, cachedPer1M: 0.5 },
  'gpt-4.1-mini': { inputPer1M: 0.4, outputPer1M: 1.6, cachedPer1M: 0.1 },
  'gpt-4.1-nano': { inputPer1M: 0.1, outputPer1M: 0.4, cachedPer1M: 0.025 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'text-embedding-3-small': { inputPer1M: 0.02, outputPer1M: 0 },
  'text-embedding-3-large': { inputPer1M: 0.13, outputPer1M: 0 },

  'claude-sonnet-4-6': { inputPer1M: 3, outputPer1M: 15 },
  'claude-opus-4-7': { inputPer1M: 15, outputPer1M: 75 },
  'claude-haiku-4-5-20251001': { inputPer1M: 1, outputPer1M: 5 },

  'MiniMax-M2.5': { inputPer1M: 0.3, outputPer1M: 1.2 },
  'MiniMax-M2.7': { inputPer1M: 0, outputPer1M: 0 },

  'qwen3:30b-a3b-instruct-2507': { inputPer1M: 0, outputPer1M: 0 },
  'qwen3.5:9b': { inputPer1M: 0, outputPer1M: 0 },
  'bge-m3': { inputPer1M: 0, outputPer1M: 0 },

  'gemini-3-pro': { inputPer1M: 0.5, outputPer1M: 3.5 },
  'gemini-3.1-pro': { inputPer1M: 0.5, outputPer1M: 3.5 },
  'gemini-3-flash': { inputPer1M: 0, outputPer1M: 0 },
  'gpt-5-4': { inputPer1M: 0, outputPer1M: 0 },
};

export function calcCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens = 0,
): number {
  const price = MODEL_PRICES[model];
  if (!price) return 0;
  const cachedCost =
    cachedTokens > 0 && price.cachedPer1M !== undefined
      ? (cachedTokens / 1_000_000) * price.cachedPer1M
      : 0;
  const fullInputTokens = Math.max(0, inputTokens - cachedTokens);
  const cost =
    (fullInputTokens / 1_000_000) * price.inputPer1M +
    cachedCost +
    (outputTokens / 1_000_000) * price.outputPer1M;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
