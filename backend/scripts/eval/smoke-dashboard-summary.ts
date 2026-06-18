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
  DASHBOARD_SUMMARY_SYSTEM_PROMPT,
  buildDashboardSummaryUserMessage,
} from '../../src/modules/dashboard/prompts/dashboard-summary.prompt';
import type {
  DirectorDashboardEntityDto,
  DirectorDashboardOpenQuestionDto,
  DirectorDashboardSignalCountersDto,
  DirectorDashboardSignalDto,
  DirectorDashboardThemeDto,
} from '../../src/modules/dashboard/dto/director-dashboard.dto';

const TASK_TYPE = 'dashboard-summary';

interface Fixture {
  period: 'week' | 'month';
  newThemes: DirectorDashboardThemeDto[];
  activeThemes: DirectorDashboardThemeDto[];
  newSignals: DirectorDashboardSignalDto[];
  signalCounters: DirectorDashboardSignalCountersDto;
  hotEntities: DirectorDashboardEntityDto[];
  openQuestions: DirectorDashboardOpenQuestionDto[];
}

async function main(): Promise<void> {
  console.log(`=== smoke ${TASK_TYPE} (${MODEL}) ===`);
  const f = await readFixture<Fixture>(TASK_TYPE);

  const userMessage = buildDashboardSummaryUserMessage({
    period: f.period,
    newThemes: f.newThemes,
    activeThemes: f.activeThemes,
    newSignals: f.newSignals,
    signalCounters: f.signalCounters,
    hotEntities: f.hotEntities,
    openQuestions: f.openQuestions,
  });

  const start = Date.now();
  let usage: Usage = {};
  let error: string | null = null;
  let modelResponse = '';
  let ranSuccessfully = false;

  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: DASHBOARD_SUMMARY_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 3000,
    } as Parameters<typeof client.chat.completions.create>[0])) as unknown as {
      choices: Array<{ message?: { content?: string | null } }>;
      usage?: Usage;
    };
    usage = resp.usage ?? {};
    const content = resp.choices[0]?.message?.content ?? '';
    modelResponse = shortResponse(content);
    if (content.trim().length > 0) {
      ranSuccessfully = true;
    } else {
      error = 'пустой ответ';
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
