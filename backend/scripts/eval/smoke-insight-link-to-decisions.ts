/**
 * Smoke-тест агента `insight-link-to-decisions` на DeepSeek-V4-Pro.
 * См. backend/src/modules/knowledge-core/prompts/insight-link-to-decisions.prompt.ts.
 *
 * Запуск: cd backend && bun run scripts/eval/smoke-insight-link-to-decisions.ts
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
import {
  INSIGHT_LINK_TO_DECISIONS_SYSTEM_PROMPT,
  INSIGHT_LINK_TO_DECISIONS_USER_TEMPLATE,
} from '../../src/modules/knowledge-core/prompts/insight-link-to-decisions.prompt';

const TASK_TYPE = 'insight-link-to-decisions';

const TOOL = {
  type: 'function' as const,
  function: {
    name: 'submit_insight_link_to_decisions',
    description: 'Связи Insight с Decision.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['linkedDecisionIds', 'reasoning'],
      properties: {
        linkedDecisionIds: {
          type: 'array',
          maxItems: 10,
          items: { type: 'string', minLength: 1, maxLength: 60 },
        },
        reasoning: { type: 'string', maxLength: 2_000 },
      },
    },
  },
};

interface Fixture {
  insightKind: string;
  insightStatement: string;
  candidates: Array<{
    id: string;
    statement: string;
    decidedAt: string | null;
    status: string;
  }>;
}

async function main(): Promise<void> {
  console.log(`=== smoke ${TASK_TYPE} (${MODEL}) ===`);
  const f = await readFixture<Fixture>(TASK_TYPE);
  const userMessage =
    INSIGHT_LINK_TO_DECISIONS_USER_TEMPLATE({
      insightKind: f.insightKind,
      insightStatement: f.insightStatement,
      candidates: f.candidates,
    }) + '\n\nВерни ответ через инструмент submit_insight_link_to_decisions.';

  const start = Date.now();
  let usage: Usage = {};
  let error: string | null = null;
  let modelResponse = '';
  let ranSuccessfully = false;

  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: INSIGHT_LINK_TO_DECISIONS_SYSTEM_PROMPT },
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
