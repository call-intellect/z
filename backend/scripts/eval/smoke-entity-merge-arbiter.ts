/**
 * Smoke-тест агента `entity-merge-arbiter` на DeepSeek-V4-Pro.
 * Промпт встроен в backend/src/modules/knowledge-core/services/entity-merge.service.ts
 * (константа ARBITER_SYSTEM_PROMPT).
 *
 * Запуск: cd backend && bun run scripts/eval/smoke-entity-merge-arbiter.ts
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

const TASK_TYPE = 'entity-merge-arbiter';

// Дубль системного промпта из entity-merge.service.ts.
const ARBITER_SYSTEM_PROMPT = `Ты — арбитр дубликатов сущностей в knowledge-core.
Получаешь одну "новую" сущность и до 5 кандидатов того же типа (того же tenant'а), ближайших по эмбеддингу.
Решаешь: новая сущность — это другое написание / алиас одного из кандидатов (verdict="merge"), или это другая сущность (verdict="distinct").

Правила:
- Учитывай metadata: для type=person — должность/email/телефон; для type=client — ИНН/домен/город; для type=project — кодовое имя; для type=product — артикул/SKU.
- НЕ сливай однофамильцев из разных компаний (если metadata явно разделяет — distinct).
- НЕ сливай разные продукты с похожими именами в разных проектах.
- Учитывай контекст блоков (recentMentions[]) — если новая сущность и кандидат упоминаются в одних и тех же блоках/контекстах, это сильный сигнал к merge.
- Если merge — поле "canonicalId" обязательно (id одного из переданных кандидатов).
- Если distinct — "canonicalId" не указывай.
- "explanation" — короткое объяснение в 1-2 предложениях, на русском.
- Ответ — строго JSON по схеме. Никакого markdown.`;

interface Fixture {
  newEntity: Record<string, unknown>;
  candidate: Record<string, unknown>;
}

const TOOL = {
  type: 'function' as const,
  function: {
    name: 'submit_arbiter_verdict',
    description: 'Вернуть вердикт арбитра: merge или distinct.',
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

async function main(): Promise<void> {
  console.log(`=== smoke ${TASK_TYPE} (${MODEL}) ===`);
  const f = await readFixture<Fixture>(TASK_TYPE);

  const userPayload = { newEntity: f.newEntity, candidate: f.candidate };
  const userMessage =
    `Новая сущность и кандидат ниже. Реши verdict.\n\n${JSON.stringify(userPayload, null, 2)}` +
    '\n\nВерни результат через инструмент submit_arbiter_verdict.';

  const start = Date.now();
  let usage: Usage = {};
  let error: string | null = null;
  let modelResponse = '';
  let ranSuccessfully = false;

  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: ARBITER_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 3000,
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
