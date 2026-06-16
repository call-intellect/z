/**
 * Variant A для диалоговой цепочки — 5 раздельных вызовов.
 *
 *   fixture (history+question+mock_blocks)
 *     → 1. contextualize  (text out: standalone-вопрос)
 *     → 2. classify       (tool out: {intent})
 *     → 3. multi-query    (tool out: {queries}) — только exploratory/analytical
 *     → 4. confidence     (tool out: {confidence, reason})
 *     → 5. answer         (text out: markdown — factual или synthetic)
 *
 * Запуск: cd backend && bun run scripts/eval/run-dialog-variant-a.ts <fixture-id>
 */
import { promises as fs } from 'fs';
import path from 'path';
import OpenAI from 'openai';

import {
  DIALOG_CLASSIFY_SYSTEM_PROMPT,
  DIALOG_CLASSIFY_JSON_SCHEMA,
  buildClassifyUserPrompt,
} from '../../src/modules/dialog-layer/prompts/classify.prompt';
import {
  DIALOG_CONTEXTUALIZE_SYSTEM_PROMPT,
  buildContextualizeUserPrompt,
} from '../../src/modules/dialog-layer/prompts/contextualize.prompt';
import {
  DIALOG_MULTI_QUERY_SYSTEM_PROMPT,
  DIALOG_MULTI_QUERY_JSON_SCHEMA,
  buildMultiQueryUserPrompt,
} from '../../src/modules/dialog-layer/prompts/multi-query.prompt';
import {
  DIALOG_CONFIDENCE_SYSTEM_PROMPT,
  DIALOG_CONFIDENCE_JSON_SCHEMA,
  buildConfidenceUserPrompt,
} from '../../src/modules/dialog-layer/prompts/confidence.prompt';
// ТЗ 2026-06-15 — единый промпт-ответчик заменил режимы factual/synthetic/
// clone_style; берём его напрямую из chat-v2.service.ts.
import { BASE_SYSTEM_PROMPT } from '../../src/modules/knowledge-core/services/chat-v2.service';

const MODEL = 'deepseek-v4-pro';
// DeepSeek-V4-Pro со скидкой 75%.
const PRICE_IN = 0.435 / 1_000_000;
const PRICE_CACHED_IN = 0.003625 / 1_000_000;
const PRICE_OUT = 0.87 / 1_000_000;

const FIXTURE_ID = process.argv[2] ?? 'dialog-01-factual';
const FIXTURE_PATH = path.resolve(
  `test/eval/dialog-experiment/fixtures/${FIXTURE_ID}.json`,
);
const REPORT_PATH = path.resolve(
  `test/eval/dialog-experiment/reports/${FIXTURE_ID}-variant-a.json`,
);

interface MockBlock {
  id: string;
  name: string;
  criticalQuestion: string;
  trustedAnswer: string;
  signalType: string;
  tags: string[];
  evidence: Array<{
    quote: string;
    speaker: string;
    sourceMeetingTitle: string;
    sourceTimestamp: string;
  }>;
}

interface DialogFixture {
  fixtureId: string;
  scenario: string;
  intent_expected: 'factual' | 'exploratory' | 'analytical' | 'clone_roleplay';
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  conversation_summary: string | null;
  user_question: string;
  standalone_expected: string;
  mock_blocks: MockBlock[];
  expected_facts: string[];
  expected_answer_mode: 'factual' | 'synthetic';
}

if (!process.env.DEEPSEEK_API_KEY) {
  console.error('✗ DEEPSEEK_API_KEY не задан');
  process.exit(1);
}
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
});

interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_cache_hit_tokens?: number;
  cached_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

interface CallReport {
  step: string;
  ok: boolean;
  ms: number;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  costUsd: number;
  error?: string;
  output?: unknown;
}

interface LocalTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

async function callDeepseek(opts: {
  step: string;
  system: string;
  user: string;
  maxTokens: number;
  tool?: LocalTool;
}): Promise<CallReport> {
  console.log(`  → ${opts.step}…`);
  const start = Date.now();
  let usage: Usage = {};
  let output: unknown = undefined;
  let error: string | undefined;

  try {
    const params: Record<string, unknown> = {
      model: MODEL,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
      max_tokens: opts.maxTokens,
    };
    if (opts.tool) {
      params.tools = [
        {
          type: 'function',
          function: {
            name: opts.tool.name,
            description: opts.tool.description,
            parameters: opts.tool.parameters,
          },
        },
      ];
      params.tool_choice = 'auto';
    }
    const resp = (await client.chat.completions.create(
      params as Parameters<typeof client.chat.completions.create>[0],
    )) as unknown as {
      choices: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{ function: { arguments: string } }>;
        };
      }>;
      usage?: Usage;
    };
    usage = resp.usage ?? {};
    const msg = resp.choices[0]?.message;
    if (opts.tool) {
      const call = msg?.tool_calls?.[0];
      if (!call) {
        error = 'модель не позвала tool';
        output = msg?.content ?? '';
      } else {
        try {
          output = JSON.parse(call.function.arguments);
        } catch (e) {
          error = `JSON.parse: ${(e as Error).message}`;
          output = call.function.arguments;
        }
      }
    } else {
      output = (msg?.content ?? '').trim();
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const ms = Date.now() - start;
  const tokensIn = usage.prompt_tokens ?? 0;
  const tokensOut = usage.completion_tokens ?? 0;
  const cachedTokens =
    usage.prompt_cache_hit_tokens ??
    usage.cached_tokens ??
    usage.prompt_tokens_details?.cached_tokens ??
    0;
  const uncached = Math.max(0, tokensIn - cachedTokens);
  const costUsd =
    uncached * PRICE_IN + cachedTokens * PRICE_CACHED_IN + tokensOut * PRICE_OUT;

  console.log(
    `    ${error ? '✗' : '✓'} ${ms} мс | вход=${tokensIn} (кэш=${cachedTokens}) выход=${tokensOut} | $${costUsd.toFixed(4)}${error ? ` | ${error}` : ''}`,
  );
  return {
    step: opts.step,
    ok: !error,
    ms,
    tokensIn,
    tokensOut,
    cachedTokens,
    costUsd,
    error,
    output,
  };
}

// ── формирование контекстного блока для answer-шагов ────────────────────────
function buildBlocksContext(blocks: MockBlock[]): string {
  return blocks
    .map(
      (b) =>
        `[BLOCK:${b.id}] (signalType=${b.signalType}, tags=${b.tags.join(',')})\nВопрос: ${b.criticalQuestion}\nОтвет: ${b.trustedAnswer}\nЦитата из встречи "${b.evidence[0]?.sourceMeetingTitle}" (${b.evidence[0]?.speaker}): «${b.evidence[0]?.quote}»`,
    )
    .join('\n\n');
}

async function main(): Promise<void> {
  console.log('=== Variant A — раздельные вызовы диалоговой цепочки ===');
  console.log(`  модель:    ${MODEL}`);
  console.log(`  фикстура:  ${path.basename(FIXTURE_PATH)}`);
  const fixture: DialogFixture = JSON.parse(
    await fs.readFile(FIXTURE_PATH, 'utf-8'),
  );
  console.log(
    `  сценарий:  ${fixture.scenario}\n  блоков:    ${fixture.mock_blocks.length}\n`,
  );

  const totalStart = Date.now();

  // Шаг 1: contextualize
  const ctxUser = buildContextualizeUserPrompt({
    summary: fixture.conversation_summary,
    history: fixture.history,
    question: fixture.user_question,
  });
  const rCtx = await callDeepseek({
    step: '1. contextualize',
    system: DIALOG_CONTEXTUALIZE_SYSTEM_PROMPT,
    user: ctxUser,
    maxTokens: 4000,
  });
  const standalone =
    typeof rCtx.output === 'string' && rCtx.output.length > 0
      ? rCtx.output
      : fixture.user_question;

  // Шаги 2 и 4 — параллельно (classify не зависит от multi-query, confidence не зависит от classify)
  console.log('\n→ параллельно: classify | confidence');
  const [rClassify, rConfidence] = await Promise.all([
    callDeepseek({
      step: '2. classify',
      system: DIALOG_CLASSIFY_SYSTEM_PROMPT,
      user: buildClassifyUserPrompt({ question: standalone }) +
        '\n\nВажно: верни результат через вызов инструмента submit_intent.',
      maxTokens: 2000,
      tool: {
        name: 'submit_intent',
        description: 'Отдать классифицированное намерение пользователя.',
        parameters: DIALOG_CLASSIFY_JSON_SCHEMA,
      },
    }),
    callDeepseek({
      step: '4. confidence',
      system: DIALOG_CONFIDENCE_SYSTEM_PROMPT,
      user: buildConfidenceUserPrompt({
        originalQuestion: fixture.user_question,
        standaloneQuestion: standalone,
      }) + '\n\nВажно: верни результат через вызов инструмента submit_confidence.',
      maxTokens: 2000,
      tool: {
        name: 'submit_confidence',
        description: 'Отдать оценку качества переформулировки.',
        parameters: DIALOG_CONFIDENCE_JSON_SCHEMA,
      },
    }),
  ]);

  const intent =
    (rClassify.output as { intent?: string })?.intent ?? fixture.intent_expected;

  // Шаг 3: multi-query — только для exploratory/analytical
  let rMulti: CallReport | null = null;
  if (intent === 'exploratory' || intent === 'analytical') {
    console.log('\n→ multi-query (intent требует)');
    rMulti = await callDeepseek({
      step: '3. multi-query',
      system: DIALOG_MULTI_QUERY_SYSTEM_PROMPT,
      user: buildMultiQueryUserPrompt({ question: standalone }) +
        '\n\nВажно: верни результат через вызов инструмента submit_queries.',
      maxTokens: 4000,
      tool: {
        name: 'submit_queries',
        description: 'Отдать 3 переформулировки запроса.',
        parameters: DIALOG_MULTI_QUERY_JSON_SCHEMA,
      },
    });
  } else {
    console.log('\n  (multi-query пропущен — intent=factual)');
  }

  // Шаг 5: answer — единый промпт-ответчик (ТЗ 2026-06-15; режимов больше нет,
  // глубину модель выбирает по вопросу). answerMode из фикстуры оставляем
  // только как метку отчёта.
  const answerMode = fixture.expected_answer_mode;
  const systemAnswer = BASE_SYSTEM_PROMPT;
  const blocksCtx = buildBlocksContext(fixture.mock_blocks);
  const userAnswer = `Вопрос пользователя: ${standalone}\n\nКонтекст (найденные блоки памяти):\n\n${blocksCtx}\n\nДай ответ согласно правилам.`;

  console.log(`\n→ 5. answer (${answerMode})`);
  const rAnswer = await callDeepseek({
    step: `5. answer-${answerMode}`,
    system: systemAnswer,
    user: userAnswer,
    maxTokens: 8000,
  });

  const totalMs = Date.now() - totalStart;
  const reports = [rCtx, rClassify, ...(rMulti ? [rMulti] : []), rConfidence, rAnswer];

  const tokensIn = reports.reduce((s, r) => s + r.tokensIn, 0);
  const tokensOut = reports.reduce((s, r) => s + r.tokensOut, 0);
  const cached = reports.reduce((s, r) => s + r.cachedTokens, 0);
  const costUsd = reports.reduce((s, r) => s + r.costUsd, 0);
  const fails = reports.filter((r) => !r.ok).length;

  console.log('\n=== Итоги ===');
  console.log(`  всего вызовов: ${reports.length}  (упало: ${fails})`);
  console.log(`  итог. время:   ${totalMs} мс`);
  console.log(`  токены: вход=${tokensIn} (кэш=${cached}) выход=${tokensOut}`);
  console.log(`  стоимость:     $${costUsd.toFixed(4)}`);

  await fs.writeFile(
    REPORT_PATH,
    JSON.stringify(
      {
        variant: 'A',
        fixtureId: fixture.fixtureId,
        model: MODEL,
        totalMs,
        totalTokensIn: tokensIn,
        totalTokensOut: tokensOut,
        totalCachedTokens: cached,
        totalCostUsd: costUsd,
        steps: reports,
        derived: {
          standalone,
          intent,
        },
      },
      null,
      2,
    ),
    'utf-8',
  );
  console.log(`\n✓ отчёт: ${REPORT_PATH}`);
}

main().catch((e) => {
  console.error('\n✗ FATAL:', e);
  process.exit(1);
});
