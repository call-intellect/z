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
  AXIS_CLASSIFY_SYSTEM_PROMPT,
  AXIS_CLASSIFY_USER_TEMPLATE,
} from '../../src/modules/knowledge-core/prompts/axis-classify.prompt';

const TASK_TYPE = 'axis-classify';

interface Fixture {
  blockName: string;
  signalType: string;
  criticalQuestion: string;
  trustedAnswer: string;
  tags: string[];
  domainWhitelist: Array<{ slug: string; name: string }>;
}

const TOOL = {
  type: 'function' as const,
  function: {
    name: 'submit_axis_classify',
    description: 'Вернуть метки по functional/temporal осям.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['functional', 'temporal'],
      properties: {
        functional: {
          type: 'array',
          maxItems: 4,
          items: {
            type: 'object',
            required: ['label', 'confidence'],
            properties: {
              label: { type: 'string' },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
            },
          },
        },
        temporal: {
          type: 'array',
          maxItems: 2,
          items: {
            type: 'object',
            required: ['label', 'confidence'],
            properties: {
              label: {
                type: 'string',
                enum: [
                  'temporal:permanent',
                  'temporal:current',
                  'temporal:past',
                  'temporal:future',
                  'temporal:periodic',
                ],
              },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
            },
          },
        },
      },
    },
  },
};

async function main(): Promise<void> {
  console.log(`=== smoke ${TASK_TYPE} (${MODEL}) ===`);
  const f = await readFixture<Fixture>(TASK_TYPE);

  const userMessage =
    AXIS_CLASSIFY_USER_TEMPLATE({
      blockName: f.blockName,
      signalType: f.signalType,
      criticalQuestion: f.criticalQuestion,
      trustedAnswer: f.trustedAnswer,
      tags: f.tags,
      domainWhitelist: f.domainWhitelist,
    }) + '\n\nВерни результат через инструмент submit_axis_classify.';

  const start = Date.now();
  let usage: Usage = {};
  let error: string | null = null;
  let modelResponse = '';
  let ranSuccessfully = false;

  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: AXIS_CLASSIFY_SYSTEM_PROMPT },
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
