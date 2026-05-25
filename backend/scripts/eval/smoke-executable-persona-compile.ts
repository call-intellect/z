/**
 * Smoke-тест taskType=executable-persona-compile.
 * Источник промпта: backend/src/modules/knowledge-core/prompts/executable-persona-compile.prompt.ts
 *
 * Выход — plain text (НЕ JSON). Просто проверяем, что вернулся непустой ответ.
 *
 * Запуск: cd backend && bun run scripts/eval/smoke-executable-persona-compile.ts
 */
import { promises as fs } from 'fs';
import path from 'path';
import OpenAI from 'openai';

import {
  EXECUTABLE_PERSONA_COMPILE_SYSTEM_PROMPT,
  EXECUTABLE_PERSONA_COMPILE_USER_TEMPLATE,
} from '../../src/modules/knowledge-core/prompts/executable-persona-compile.prompt';

const TASK_TYPE = 'executable-persona-compile';
const MODEL = 'deepseek-v4-pro';
const PRICE_IN = 0.435 / 1_000_000;
const PRICE_OUT = 0.87 / 1_000_000;

const SCRIPT_DIR = path
  .dirname(new URL(import.meta.url).pathname)
  .replace(/^\/([A-Za-z]):/, '$1:');
const FIXTURE_PATH = path.resolve(
  SCRIPT_DIR,
  `../../test/eval/smoke-all-agents/fixtures/${TASK_TYPE}.json`,
);
const REPORT_PATH = path.resolve(
  SCRIPT_DIR,
  `../../test/eval/smoke-all-agents/reports/${TASK_TYPE}.json`,
);

interface Fixture {
  personName: string;
  personRole: string | null;
  traits: Array<{
    category: string;
    statement: string;
    confidence: string;
    observationCount: number;
  }>;
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
  const userMessage = EXECUTABLE_PERSONA_COMPILE_USER_TEMPLATE({
    personName: fixture.personName,
    personRole: fixture.personRole,
    traits: fixture.traits,
  });

  const start = Date.now();
  let usage: { prompt_tokens?: number; completion_tokens?: number } = {};
  let modelResponse = '';
  let error: string | undefined;
  let ranSuccessfully = false;

  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: EXECUTABLE_PERSONA_COMPILE_SYSTEM_PROMPT },
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
