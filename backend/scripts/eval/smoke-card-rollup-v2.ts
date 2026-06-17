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
import { getCardRollupV2SystemPrompt } from '../../src/modules/knowledge-core/prompts/card-rollup-v2.prompts';

const TASK_TYPE = 'card-rollup-v2';

interface Fixture {
  kind: 'client' | 'deal' | 'project' | 'topic' | 'vendor' | 'custom';
  cardName: string;
  ideaBlocks: Array<{
    id: string;
    criticalQuestion: string;
    trustedAnswer: string;
    signalType: string;
    tags: string[];
    quotes: string[];
  }>;
  topThemes: string[];
}

async function main(): Promise<void> {
  console.log(`=== smoke ${TASK_TYPE} (${MODEL}) ===`);
  const f = await readFixture<Fixture>(TASK_TYPE);
  const systemPrompt = getCardRollupV2SystemPrompt(f.kind);

  const blocksText = f.ideaBlocks
    .map(
      (b, i) =>
        `Блок ${i + 1} (${b.signalType}):\n  Вопрос: ${b.criticalQuestion}\n  Ответ: ${b.trustedAnswer}\n  Теги: ${b.tags.join(', ')}\n  Цитаты: ${b.quotes.length ? b.quotes.join(' | ') : '(нет)'}`,
    )
    .join('\n\n');

  const userMessage = [
    `Карточка: «${f.cardName}» (kind=${f.kind}).`,
    '',
    `Топ-темы по этой карточке: ${f.topThemes.join('; ')}.`,
    '',
    "IdeaBlock'и:",
    blocksText,
    '',
    'Дай связный обзор по правилам системного промпта.',
  ].join('\n');

  const start = Date.now();
  let usage: Usage = {};
  let error: string | null = null;
  let modelResponse = '';
  let ranSuccessfully = false;

  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 4000,
    } as Parameters<typeof client.chat.completions.create>[0])) as unknown as {
      choices: Array<{ message?: { content?: string | null } }>;
      usage?: Usage;
    };
    usage = resp.usage ?? {};
    const text = resp.choices[0]?.message?.content ?? '';
    modelResponse = shortResponse(text);
    if (text.trim().length > 30) {
      ranSuccessfully = true;
    } else {
      error = 'пустой/слишком короткий ответ';
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
