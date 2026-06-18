import { promises as fs } from 'fs';
import path from 'path';
import OpenAI from 'openai';

const TASK_TYPE = 'concierge-respond';
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
  userMessage: string;
  contextBlock: string;
  toolFragment: string;
}

function buildSystemPrompt(contextBlock: string, toolFragment: string): string {
  return [
    'Ты — Concierge, AI-помощник в кабинете компании Z (Кора).',
    'Отвечай по-русски, кратко и по делу.',
    '',
    '=== КОНТЕКСТ ===',
    contextBlock || '(контекст недоступен)',
    '',
    '=== ДОСТУПНЫЕ ИНСТРУМЕНТЫ ===',
    'Если запрос требует действия — верни ОДНУ строку строго в формате JSON:',
    '{"tool_call": {"name": "<имя>", "arguments": { ... }}}',
    'Если действие не требуется — верни просто текст ответа без JSON.',
    'Имя инструмента ДОЛЖНО быть из списка ниже:',
    toolFragment,
    '',
    'Принципы:',
    '- Никогда не выдумывай данные. Если не знаешь — используй search_knowledge или ask_chat_v2.',
    '- Если в пользовательском сообщении есть блок «=== ПРЕДВАРИТЕЛЬНЫЕ РЕЗУЛЬТАТЫ ПОИСКА ===» — опирайся на него; если данных достаточно, отвечай без новых вызовов search_knowledge.',
    '- Для создания/изменения ресурсов — предпочитай tools с undoableVia (их можно отменить).',
    '- Если необходимо подтверждение пользователя — добавь в текст ответа явный вопрос.',
  ].join('\n');
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

  const systemPrompt = buildSystemPrompt(fixture.contextBlock, fixture.toolFragment);
  const userMessage = `Новый запрос пользователя: ${fixture.userMessage}`;

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
      max_tokens: 1500,
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

  const isToolCall = /\{\s*"tool_call"/.test(modelResponse);

  const report = {
    taskType: TASK_TYPE,
    promptFound: true,
    ranSuccessfully,
    tokensIn,
    tokensOut,
    costUsd,
    ms,
    modelResponse: modelResponse.slice(0, 300),
    interpretation: isToolCall ? 'tool_call' : 'final_text',
    error,
  };
  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');

  console.log(
    `  ${ranSuccessfully ? 'OK' : 'FAIL'} ${ms} мс | вход=${tokensIn} выход=${tokensOut} | $${costUsd.toFixed(4)} | ${isToolCall ? 'tool_call' : 'final_text'}${error ? ` | ${error}` : ''}`,
  );
  console.log(`  отчёт: ${REPORT_PATH}`);
  console.log(`  ответ (первые 200): ${modelResponse.slice(0, 200)}`);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
