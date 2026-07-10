import { describe, expect, it } from 'vitest';

import { EnvSchema } from './env.schema';

const DB_MANAGED_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'DEEPSEEK_API_KEY',
  'MINIMAX_API_KEY',
  'GRSAI_API_KEY',
  'KIE_API_KEY',
  'OLLAMA_API_KEY',
  'VOX_API_TOKEN',
] as const;

describe('env.schema — ключи LLM-провайдеров не обязательны (живут в llm_providers)', () => {
  const shape = (EnvSchema as unknown as { shape: Record<string, { parse: (v: unknown) => unknown } > }).shape;

  it.each(DB_MANAGED_KEYS)('%s: отсутствие в ENV → пустая строка, старт не блокируется', (key) => {
    expect(shape[key]!.parse(undefined)).toBe('');
  });
});
