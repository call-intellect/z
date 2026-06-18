import { promises as fs } from 'fs';
import path from 'path';
import OpenAI from 'openai';

import {
  buildGoalAlignmentMessages,
  GOAL_ALIGNMENT_JSON_SCHEMA,
  GoalAlignmentResponseSchema,
  type GoalAlignmentInput,
} from '../../src/modules/knowledge-core/prompts/goal-alignment.prompt';

const TASK_TYPE = 'goal-alignment';
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

if (!process.env.DEEPSEEK_API_KEY) {
  console.error('DEEPSEEK_API_KEY не задан');
  process.exit(1);
}
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
});

const GOAL_TOOL = {
  type: 'function' as const,
  function: {
    name: 'submit_goal_alignment',
    description: 'Отдай оценку выравнивания компании к цели за окно.',
    parameters: GOAL_ALIGNMENT_JSON_SCHEMA,
  },
};

async function main(): Promise<void> {
  console.log(`=== smoke ${TASK_TYPE} ===`);
  const fixture: GoalAlignmentInput = JSON.parse(await fs.readFile(FIXTURE_PATH, 'utf-8'));

  const { systemPrompt, userMessage } = buildGoalAlignmentMessages(fixture);
  const userWithToolHint = `${userMessage}\n\nВерни результат через инструмент submit_goal_alignment.`;

  const start = Date.now();
  let usage: { prompt_tokens?: number; completion_tokens?: number } = {};
  let modelResponse = '';
  let error: string | undefined;
  let ranSuccessfully = false;
  let parsedOk = false;
  let zodOk = false;

  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userWithToolHint },
      ],
      max_tokens: 4000,
      tools: [GOAL_TOOL],
      tool_choice: 'auto',
    } as Parameters<typeof client.chat.completions.create>[0])) as unknown as {
      choices: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{ function: { name: string; arguments: string } }>;
        };
      }>;
      usage?: typeof usage;
    };
    usage = resp.usage ?? {};
    const msg = resp.choices[0]?.message;
    const call = msg?.tool_calls?.[0];
    if (call) {
      modelResponse = call.function.arguments;
      try {
        const parsed = JSON.parse(modelResponse);
        parsedOk = true;
        const zResult = GoalAlignmentResponseSchema.safeParse(parsed);
        zodOk = zResult.success;
        ranSuccessfully = zodOk;
        if (!zodOk) {
          error = `Zod failed: ${JSON.stringify(zResult.error.issues).slice(0, 300)}`;
        }
      } catch (e) {
        error = `JSON.parse tool args: ${(e as Error).message}`;
      }
    } else {
      modelResponse = msg?.content ?? '';
      error = 'модель не вызвала tool submit_goal_alignment';
    }
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
    parsedOk,
    zodOk,
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
