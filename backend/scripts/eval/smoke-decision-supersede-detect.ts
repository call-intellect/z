/**
 * Smoke-тест агента `decision-supersede-detect` на DeepSeek-V4-Pro.
 * См. backend/src/modules/knowledge-core/prompts/decision-supersede-detect.prompt.ts.
 *
 * Запуск: cd backend && bun run scripts/eval/smoke-decision-supersede-detect.ts
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
  DECISION_SUPERSEDE_DETECT_SYSTEM_PROMPT,
  DECISION_SUPERSEDE_DETECT_USER_TEMPLATE,
} from '../../src/modules/knowledge-core/prompts/decision-supersede-detect.prompt';

const TASK_TYPE = 'decision-supersede-detect';

const TOOL = {
  type: 'function' as const,
  function: {
    name: 'submit_decision_supersede_verdict',
    description: 'Verdict арбитра по реестру решений.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['verdict', 'reasoning'],
      properties: {
        verdict: { type: 'string', enum: ['new', 'merge', 'supersedes'] },
        targetId: { type: ['string', 'null'] },
        reasoning: { type: 'string', maxLength: 2_000 },
        evolvingMeta: {
          type: ['object', 'null'],
          additionalProperties: false,
          properties: {
            existingValidUntil: { type: 'string' },
            newValidFrom: { type: 'string' },
          },
          required: ['existingValidUntil', 'newValidFrom'],
        },
      },
    },
  },
};

interface Fixture {
  draft: { statement: string; rationale: string | null; decidedAt: string | null };
  candidates: Array<{
    id: string;
    statement: string;
    rationale: string | null;
    decidedAt: string | null;
    status: string;
  }>;
}

async function main(): Promise<void> {
  console.log(`=== smoke ${TASK_TYPE} (${MODEL}) ===`);
  const f = await readFixture<Fixture>(TASK_TYPE);
  const userMessage =
    DECISION_SUPERSEDE_DETECT_USER_TEMPLATE({
      draft: f.draft,
      candidates: f.candidates,
    }) + '\n\nВерни verdict через инструмент submit_decision_supersede_verdict.';

  const start = Date.now();
  let usage: Usage = {};
  let error: string | null = null;
  let modelResponse = '';
  let ranSuccessfully = false;

  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: DECISION_SUPERSEDE_DETECT_SYSTEM_PROMPT },
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
