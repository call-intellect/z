/**
 * Smoke-тест агента `operations-daily-digest` на DeepSeek-V4-Pro.
 * Промпт из backend/src/modules/operations/prompts/daily-digest.prompt.ts.
 *
 * Ответ — markdown с разделителем ---SHORT_SUMMARY---. Без tool/JSON.
 *
 * Запуск: cd backend && bun run scripts/eval/smoke-daily-digest.ts
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
  DAILY_DIGEST_SYSTEM_PROMPT,
  buildDailyDigestUserMessage,
} from '../../src/modules/operations/prompts/daily-digest.prompt';
import type { DailyDigestAggregates } from '../../src/modules/operations/dto/daily-digest.dto';

const TASK_TYPE = 'daily-digest';

type Fixture = DailyDigestAggregates & { fixtureId: string; description: string };

async function main(): Promise<void> {
  console.log(`=== smoke ${TASK_TYPE} (${MODEL}) ===`);
  const f = await readFixture<Fixture>(TASK_TYPE);

  const userMessage = buildDailyDigestUserMessage({
    dateLocal: f.dateLocal,
    totalCheckIns: f.totalCheckIns,
    greenShare: f.greenShare,
    yellowShare: f.yellowShare,
    redShare: f.redShare,
    topRedCheckIns: f.topRedCheckIns,
    newBlockers: f.newBlockers,
    overdueCommitments: f.overdueCommitments,
    goals: f.goals,
    newHighInsights: f.newHighInsights,
    decisions: f.decisions,
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
        { role: 'system', content: DAILY_DIGEST_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 4000,
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
