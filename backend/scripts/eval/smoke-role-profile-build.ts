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
  buildRoleProfilePrompt,
  type RoleContextForPrompt,
} from '../../src/modules/knowledge-core/prompts/role-profile-build.prompt';

const TASK_TYPE = 'role-profile-build';

interface Fixture extends RoleContextForPrompt {
  fixtureId: string;
  description: string;
}

const TOOL = {
  type: 'function' as const,
  function: {
    name: 'submit_role_profile',
    description: 'Вернуть карту должности (Role Map).',
    parameters: {
      type: 'object',
      additionalProperties: true,
      required: ['responsibilities', 'style_profile', 'completeness_self_rating'],
      properties: {
        responsibilities: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              kind: { type: 'string' },
              details: { type: 'string' },
              evidence: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        authority: { type: 'array' },
        knowledge: { type: 'array' },
        decisions: { type: 'array' },
        interactions: { type: 'array' },
        metrics: { type: 'array' },
        ownership: { type: 'array' },
        kpi_links: { type: 'array' },
        style_profile: { type: 'string' },
        completeness_self_rating: { type: 'number' },
        skills: { type: 'array' },
        decision_patterns: { type: 'array' },
        common_pitfalls: { type: 'array' },
      },
    },
  },
};

async function main(): Promise<void> {
  console.log(`=== smoke ${TASK_TYPE} (${MODEL}) ===`);
  const f = await readFixture<Fixture>(TASK_TYPE);

  const { system, user } = buildRoleProfilePrompt({
    role: f.role,
    jobDescriptionMd: f.jobDescriptionMd,
    persons: f.persons,
    ideaBlocks: f.ideaBlocks,
    themes: f.themes,
    processes: f.processes,
    decisions: f.decisions,
  });
  const userMessage = user + '\n\nВерни результат через инструмент submit_role_profile.';

  const start = Date.now();
  let usage: Usage = {};
  let error: string | null = null;
  let modelResponse = '';
  let ranSuccessfully = false;

  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 16000,
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
