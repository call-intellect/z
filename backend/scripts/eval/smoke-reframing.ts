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

const TASK_TYPE = 'reframing';

const REFRAMING_SYSTEM_PROMPT = `Ты — аналитик, переосмысливающий граф знания компании.
На вход — список IdeaBlock'ов за последнюю неделю (имя + критический вопрос + доверенный ответ).

Твоя задача — найти ВЫСОКОУРОВНЕВЫЕ паттерны:
1. "splitCandidates" — id блоков, которые на самом деле смешивают две разные темы и стоит разделить.
2. "mergeCandidates" — пары id блоков (a, b), которые описывают одну и ту же идею и стоит слить.
3. "themeShifts" — короткие фразы, описывающие сдвиг фокуса (например, "стало больше про маркетинг, меньше про продукт").
4. "analysis" — общий вывод (1-2 абзаца): что компания обсуждала на этой неделе, какие тренды.

Правила:
- Не выдумывай. Если блоков мало или они разрозненные — просто короткий "analysis", остальные поля можно опустить.
- "analysis" — на русском, без markdown.
- Ответ — строго JSON по схеме.`;

interface Fixture {
  blocks: Array<{
    id: string;
    name: string;
    criticalQuestion: string;
    trustedAnswer: string;
  }>;
}

const TOOL = {
  type: 'function' as const,
  function: {
    name: 'submit_reframing',
    description: 'Вернуть результат переосмысления графа: split/merge кандидаты + analysis.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['analysis'],
      properties: {
        analysis: { type: 'string' },
        splitCandidates: { type: 'array', items: { type: 'string' } },
        mergeCandidates: {
          type: 'array',
          items: {
            type: 'object',
            required: ['a', 'b'],
            properties: { a: { type: 'string' }, b: { type: 'string' } },
          },
        },
        themeShifts: { type: 'array', items: { type: 'string' } },
      },
    },
  },
};

async function main(): Promise<void> {
  console.log(`=== smoke ${TASK_TYPE} (${MODEL}) ===`);
  const f = await readFixture<Fixture>(TASK_TYPE);

  const userPayload = f.blocks.map((b) => ({
    id: b.id,
    name: b.name,
    criticalQuestion: b.criticalQuestion,
    trustedAnswer: b.trustedAnswer,
  }));
  const userMessage =
    `Блоки за последние 7 дней:\n\n${JSON.stringify(userPayload, null, 2)}` +
    '\n\nВерни результат через инструмент submit_reframing.';

  const start = Date.now();
  let usage: Usage = {};
  let error: string | null = null;
  let modelResponse = '';
  let ranSuccessfully = false;

  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: REFRAMING_SYSTEM_PROMPT },
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
