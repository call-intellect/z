import { promises as fs } from 'fs';
import path from 'path';
import OpenAI from 'openai';

import { CHAT_V2_SYNTHESIZE_MODE_PROMPTS } from '../../src/modules/chat-v2/prompts/chat-v2-synthesize.prompt';

const BASE_SYSTEM_PROMPT = `Ты — AI-аналитик компании, работаешь на знании из её встреч и переписок.

Правила:
- Отвечай на русском, кратко и по делу (2-6 предложений; для сложных вопросов — до 12).
- Опирайся ТОЛЬКО на блоки из раздела «Контекст» ниже. Если данных нет — честно скажи "Недостаточно данных" и НЕ выдумывай.
- Когда ссылаешься на конкретный блок — обязательно ставь маркер вида [BLOCK:<id>] прямо в тексте, рядом с фактом. Можно несколько маркеров на одно утверждение.
- Если блоки противоречат друг другу — упомяни это и сошлись на оба ([BLOCK:<id1>] vs [BLOCK:<id2>]).
- Не выдумывай blockId, которых нет в контексте.`;

const TASK_TYPE = 'chat-v2-synthesize';
const MODEL = 'deepseek-v4-pro';
const PRICE_IN = 0.435 / 1_000_000;
const PRICE_OUT = 0.87 / 1_000_000;

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]):/, '$1:');
const FIXTURE_PATH = path.resolve(
  SCRIPT_DIR,
  `../../test/eval/smoke-all-agents/fixtures/${TASK_TYPE}.json`,
);
const REPORT_PATH = path.resolve(
  SCRIPT_DIR,
  `../../test/eval/smoke-all-agents/reports/${TASK_TYPE}.json`,
);

interface Fixture {
  query: string;
  mode: 'factual' | 'synthetic';
  contextBlocks: Array<{ id: string; snippet: string }>;
}

if (!process.env.DEEPSEEK_API_KEY) {
  console.error('DEEPSEEK_API_KEY не задан');
  process.exit(1);
}
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
});

async function main(): Promise<void> {
  console.log(`=== smoke ${TASK_TYPE} ===`);
  const fixture: Fixture = JSON.parse(await fs.readFile(FIXTURE_PATH, 'utf-8'));

  const modePrompt = CHAT_V2_SYNTHESIZE_MODE_PROMPTS[fixture.mode];
  const systemPrompt = `${BASE_SYSTEM_PROMPT}\n\n${modePrompt}`;
  const contextStr = fixture.contextBlocks.map((b) => `[BLOCK:${b.id}] ${b.snippet}`).join('\n');
  const userMessage = `Контекст:\n${contextStr}\n\nВопрос: ${fixture.query}`;

  const start = Date.now();
  let usage: { prompt_tokens?: number; completion_tokens?: number } = {};
  let modelResponse = '';
  let error: string | undefined;
  let ranSuccessfully = false;

  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 4000,
    } as Parameters<typeof client.chat.completions.create>[0])) as unknown as {
      choices: Array<{ message?: { content?: string | null } }>;
      usage?: typeof usage;
    };
    usage = resp.usage ?? {};
    modelResponse = resp.choices[0]?.message?.content ?? '';
    ranSuccessfully = modelResponse.trim().length > 0;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const ms = Date.now() - start;
  const tokensIn = usage.prompt_tokens ?? 0;
  const tokensOut = usage.completion_tokens ?? 0;
  const costUsd = tokensIn * PRICE_IN + tokensOut * PRICE_OUT;

  const report = {
    taskType: TASK_TYPE,
    promptFound: true,
    ranSuccessfully,
    tokensIn,
    tokensOut,
    costUsd,
    ms,
    modelResponse: modelResponse.slice(0, 300),
    error,
  };
  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');

  console.log(
    `  ${ranSuccessfully ? 'OK' : 'FAIL'} ${ms} мс | вход=${tokensIn} выход=${tokensOut} | $${costUsd.toFixed(4)}${error ? ` | ${error}` : ''}`,
  );
  console.log(`  отчёт: ${REPORT_PATH}`);
  console.log(`  ответ (первые 200): ${modelResponse.slice(0, 200)}`);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
