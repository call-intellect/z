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
  IDEA_CLUSTER_MERGE_SYSTEM_PROMPT,
  IDEA_CLUSTER_MERGE_USER_TEMPLATE,
} from '../../src/modules/knowledge-core/prompts/idea-cluster-merge.prompt';

const TASK_TYPE = 'idea-cluster-merge';

const TOOL = {
  type: 'function' as const,
  function: {
    name: 'submit_idea_cluster_merge',
    description: 'Решение арбитра по кластеру для новой идеи.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['verdict', 'confidence'],
      properties: {
        verdict: {
          type: 'string',
          enum: ['new_cluster', 'add_to_existing', 'standalone'],
        },
        targetClusterId: { type: ['string', 'null'] },
        newClusterName: { type: ['string', 'null'], maxLength: 200 },
        newClusterDescription: { type: ['string', 'null'], maxLength: 2_000 },
        reasoning: { type: ['string', 'null'], maxLength: 2_000 },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
  },
};

interface Fixture {
  ideaStatement: string;
  ideaRationale: string | null;
  candidates: Array<{
    id: string;
    name: string;
    description: string | null;
    sampleStatements: string[];
  }>;
}

async function main(): Promise<void> {
  console.log(`=== smoke ${TASK_TYPE} (${MODEL}) ===`);
  const f = await readFixture<Fixture>(TASK_TYPE);
  const userMessage =
    IDEA_CLUSTER_MERGE_USER_TEMPLATE({
      ideaStatement: f.ideaStatement,
      ideaRationale: f.ideaRationale,
      candidates: f.candidates,
    }) + '\n\nВерни ответ через инструмент submit_idea_cluster_merge.';

  const start = Date.now();
  let usage: Usage = {};
  let error: string | null = null;
  let modelResponse = '';
  let ranSuccessfully = false;

  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: IDEA_CLUSTER_MERGE_SYSTEM_PROMPT },
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
