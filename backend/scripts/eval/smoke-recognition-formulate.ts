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
  RECOGNITION_FORMULATE_SYSTEM_PROMPT,
  RECOGNITION_FORMULATE_USER_TEMPLATE,
  type RecognitionFormulateTemplateArgs,
} from '../../src/modules/recognition/prompts/recognition-formulate.prompt';

const TASK_TYPE = 'recognition-formulate';

interface Fixture extends RecognitionFormulateTemplateArgs {
  fixtureId: string;
  description: string;
}

const TOOL = {
  type: 'function' as const,
  function: {
    name: 'submit_recognition',
    description: 'Вернуть короткое тёплое сообщение благодарности.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['message'],
      properties: {
        message: { type: 'string' },
      },
    },
  },
};

async function main(): Promise<void> {
  console.log(`=== smoke ${TASK_TYPE} (${MODEL}) ===`);
  const f = await readFixture<Fixture>(TASK_TYPE);

  const userMessage =
    RECOGNITION_FORMULATE_USER_TEMPLATE({
      type: f.type,
      toUserName: f.toUserName,
      fromUserName: f.fromUserName,
      payload: f.payload,
    }) + '\n\nВерни результат через инструмент submit_recognition.';

  const start = Date.now();
  let usage: Usage = {};
  let error: string | null = null;
  let modelResponse = '';
  let ranSuccessfully = false;

  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: RECOGNITION_FORMULATE_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 2000,
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
