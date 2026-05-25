/**
 * Smoke-тест агента `block-distill` на DeepSeek-V4-Pro.
 * Промпт встроен в backend/src/modules/knowledge-core/services/block-merge.service.ts
 * (константа JUDGE_SYSTEM_PROMPT). Здесь дублируем текст промпта 1:1 для smoke.
 *
 * Запуск: cd backend && bun run scripts/eval/smoke-block-distill.ts
 */
import {
  client,
  computeCost,
  logRun,
  MODEL,
  readFixture,
  shortResponse,
  type SmokeReport,
  type Usage,
  writeReport,
} from './_smoke-shared';

const TASK_TYPE = 'block-distill';

const JUDGE_SYSTEM_PROMPT = `Ты — арбитр дубликатов знания.
Получаешь один новый IdeaBlock и до 5 кандидатов-канонических блоков, ближайших к нему по эмбеддингу.
Решаешь: новый блок — это перефразировка одного из кандидатов (verdict="merge"), или это отдельное самостоятельное знание (verdict="distinct").

Правила:
- merge только если новый блок ОТВЕЧАЕТ НА ТОТ ЖЕ ВОПРОС, что и кандидат, и trustedAnswer семантически совместим.
- Разные signalType (например, fact vs pain) — почти всегда distinct.
- Разные сущности (разные клиенты/проекты) — distinct, даже при похожем тексте.
- Если merge — поле "canonicalId" обязательно (id одного из переданных кандидатов).
- Если distinct — "canonicalId" не указывай.
- "explanation" — короткое объяснение в 1-2 предложениях, на русском.
- Ответ — строго JSON по схеме. Никакого markdown.`;

const TOOL = {
  type: 'function' as const,
  function: {
    name: 'submit_block_distill_verdict',
    description: 'Решение арбитра по дубликату.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['verdict', 'explanation'],
      properties: {
        verdict: { type: 'string', enum: ['merge', 'distinct'] },
        canonicalId: { type: 'string' },
        explanation: { type: 'string' },
      },
    },
  },
};

interface Fixture {
  newBlock: Record<string, unknown>;
  candidates: Record<string, unknown>[];
}

async function main(): Promise<void> {
  console.log(`=== smoke ${TASK_TYPE} (${MODEL}) ===`);
  const f = await readFixture<Fixture>(TASK_TYPE);

  const userPayload = { newBlock: f.newBlock, candidates: f.candidates };
  const userMessage =
    `Новый блок и кандидаты ниже. Реши verdict.\n\n${JSON.stringify(userPayload, null, 2)}\n\nВерни решение через инструмент submit_block_distill_verdict.`;

  const start = Date.now();
  let usage: Usage = {};
  let error: string | null = null;
  let modelResponse = '';
  let ranSuccessfully = false;

  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: JUDGE_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 4000,
      tools: [TOOL],
      tool_choice: 'auto',
    } as Parameters<typeof client.chat.completions.create>[0])) as unknown as {
      choices: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{ function: { name: string; arguments: string } }>;
        };
      }>;
      usage?: Usage;
    };
    usage = resp.usage ?? {};
    const msg = resp.choices[0]?.message;
    const call = msg?.tool_calls?.[0];
    if (call) {
      modelResponse = shortResponse(call.function.arguments);
      JSON.parse(call.function.arguments);
      ranSuccessfully = true;
    } else {
      modelResponse = shortResponse(msg?.content ?? '');
      error = 'модель не позвала tool';
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const ms = Date.now() - start;
  const cost = computeCost(usage);
  const report: SmokeReport = {
    taskType: TASK_TYPE,
    promptFound: true,
    ranSuccessfully,
    tokensIn: cost.tokensIn,
    tokensOut: cost.tokensOut,
    cachedTokens: cost.cachedTokens,
    costUsd: cost.costUsd,
    ms,
    modelResponse,
    error,
  };
  logRun(TASK_TYPE, report);
  await writeReport(TASK_TYPE, report);
}

main().catch((e) => {
  console.error('\n✗ FATAL:', e);
  process.exit(1);
});
