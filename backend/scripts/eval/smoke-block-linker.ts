/**
 * Smoke-тест агента `block-linker` на DeepSeek-V4-Pro.
 * Промпт встроен в backend/src/modules/knowledge-core/services/block-link.service.ts
 * (константа LINK_SYSTEM_PROMPT). Здесь дублируем текст 1:1.
 *
 * Запуск: cd backend && bun run scripts/eval/smoke-block-linker.ts
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

const TASK_TYPE = 'block-linker';

const LINK_SYSTEM_PROMPT = `Ты — эксперт по связям между знаниями.
На вход даются два IdeaBlock — A (новый) и B (кандидат). Каждый — пара "критический вопрос → доверенный ответ".

Твоя задача: определить, есть ли между A и B устойчивая логическая связь, и если да — какого типа.

Возможные типы связей (выбирай один):
- "develops" — B продолжает / расширяет / уточняет идею A.
- "contradicts" — B противоречит A (разные ответы на тот же вопрос).
- "causes" — A является причиной B (A влечёт B).
- "consequences_of" — A является следствием B.
- "shares_topic" — оба про одну тему / область, но без причинной связи.
- "shares_entity" — оба упоминают одну ключевую сущность (клиента, проект и т.п.).
- "question_answered_by" — критический вопрос A прямо отвечает trustedAnswer B (или наоборот).
- "none" — связи нет, блоки независимы.

Правила:
- Связь должна быть СОДЕРЖАТЕЛЬНОЙ. Если просто "оба про маркетинг" — это слишком общо, ставь "none".
- Не выдумывай связь, если её нет. "none" — нормальный ответ.
- "confidence" ∈ [0,1] — насколько ты уверен. 0.9+ только если связь явная.
- "explanation" — 1-2 короткие фразы на русском.
- Ответ — строго JSON по схеме. Никакого markdown.`;

const TOOL = {
  type: 'function' as const,
  function: {
    name: 'submit_block_link_verdict',
    description: 'Решение по типу связи между двумя блоками.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['relationType', 'confidence', 'explanation'],
      properties: {
        relationType: {
          type: 'string',
          enum: [
            'develops',
            'contradicts',
            'causes',
            'consequences_of',
            'shares_topic',
            'shares_entity',
            'question_answered_by',
            'none',
          ],
        },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        explanation: { type: 'string', maxLength: 500 },
      },
    },
  },
};

interface Fixture {
  blockA: Record<string, unknown>;
  blockB: Record<string, unknown>;
}

async function main(): Promise<void> {
  console.log(`=== smoke ${TASK_TYPE} (${MODEL}) ===`);
  const f = await readFixture<Fixture>(TASK_TYPE);

  const userPayload = { blockA: f.blockA, blockB: f.blockB };
  const userMessage =
    `Блок A и блок B ниже. Определи тип связи (или "none").\n\n${JSON.stringify(userPayload, null, 2)}\n\nВерни решение через инструмент submit_block_link_verdict.`;

  const start = Date.now();
  let usage: Usage = {};
  let error: string | null = null;
  let modelResponse = '';
  let ranSuccessfully = false;

  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: LINK_SYSTEM_PROMPT },
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
