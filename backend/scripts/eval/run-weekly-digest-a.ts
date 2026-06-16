import { promises as fs } from 'fs';
import path from 'path';
import OpenAI from 'openai';

const MODEL = 'deepseek-v4-pro';
const PRICE_IN = 0.435 / 1_000_000;
const PRICE_CACHED_IN = 0.003625 / 1_000_000;
const PRICE_OUT = 0.87 / 1_000_000;

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]):/, '$1:');
const AGGREGATE_PATH = path.resolve(
  SCRIPT_DIR,
  '../../test/eval/operations-experiment/fixtures/week-aggregate.json',
);
const REPORT_JSON = path.resolve(
  SCRIPT_DIR,
  '../../test/eval/operations-experiment/reports/variant-a-weekly-digest.json',
);
const REPORT_MD = path.resolve(
  SCRIPT_DIR,
  '../../test/eval/operations-experiment/reports/variant-a-weekly-digest.md',
);

if (!process.env.DEEPSEEK_API_KEY) {
  console.error('✗ DEEPSEEK_API_KEY не задан');
  process.exit(1);
}
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
});

const SYSTEM_PROMPT = [
  'Ты — аналитик операционного директора. На вход — агрегат показателей компании за прошедшую неделю.',
  'Твоя задача — собрать связный комментарий из 5-7 коротких разделов в формате Markdown:',
  '',
  '  1. Температура команды (доли зелёных/жёлтых/красных, динамика, тревожные моменты).',
  '  2. Главные блокеры (повторяющиеся, что мешает регулярно).',
  '  3. Сигналы недели (топ-инсайты — что обостряется).',
  '  4. Цели (что закрыли, что провалили, что в работе; динамика к прошлой неделе).',
  '  5. Висящие решения (что зависло без отметки о результате).',
  '  6. Главный вывод (1-2 предложения — на что обратить внимание в первую очередь).',
  '',
  'Жёсткие правила:',
  '  - На русском, plain markdown без HTML и без таблиц.',
  '  - Только то, что есть в данных. Не додумывай и не давай советов на пустом месте.',
  '  - Без воды и без преамбулы. Сразу к делу.',
  '  - Тон — спокойный и фактологичный (не алармизм, не оптимизм).',
  '  - Если по какому-то блоку данных нет — пропусти раздел, не пиши «нет данных» как пункт.',
  '  - Не называй сотрудников по именам и не цитируй персональные подробности из чек-инов (приватность).',
  '  - Длина — 250-600 слов.',
].join('\n');

interface Aggregate {
  weekStart: string;
  weekEnd: string;
  totalCheckIns: number;
  greenShare: number;
  yellowShare: number;
  redShare: number;
  topBlockers: Array<{ text: string; count: number }>;
  topInsights: Array<{ statement: string; kind: string; dynamicLabel: string }>;
  goals: {
    completed: number;
    failed: number;
    inProgress: number;
    completedDelta: number;
    failedDelta: number;
  };
  hangingDecisions: Array<{ statement: string; ageDays: number }>;
}

function buildUserMessage(agg: Aggregate): string {
  const lines: string[] = [];
  lines.push(`Период: ${agg.weekStart} — ${agg.weekEnd}.`);
  lines.push('');
  lines.push('Температура команды:');
  lines.push(
    `  всего чек-инов: ${agg.totalCheckIns}; зелёных ${pct(agg.greenShare)}, ` +
      `жёлтых ${pct(agg.yellowShare)}, красных ${pct(agg.redShare)}.`,
  );

  if (agg.topBlockers.length > 0) {
    lines.push('');
    lines.push('Повторяющиеся блокеры (топ-5):');
    for (const b of agg.topBlockers.slice(0, 5)) {
      lines.push(`  - ${truncate(b.text, 200)} (упоминаний: ${b.count}).`);
    }
  }

  if (agg.topInsights.length > 0) {
    lines.push('');
    lines.push('Главные сигналы (топ-3 по динамике):');
    for (const i of agg.topInsights.slice(0, 3)) {
      lines.push(`  - [${i.kind}, динамика ${i.dynamicLabel}] ${truncate(i.statement, 200)}.`);
    }
  }

  lines.push('');
  lines.push('Цели:');
  lines.push(
    `  закрыто ${agg.goals.completed} (${signed(agg.goals.completedDelta)} к прошлой неделе), ` +
      `провалено ${agg.goals.failed} (${signed(agg.goals.failedDelta)}), в работе ${agg.goals.inProgress}.`,
  );

  if (agg.hangingDecisions.length > 0) {
    lines.push('');
    lines.push('Висящие решения (старше 7 дней без отметки о результате):');
    for (const d of agg.hangingDecisions.slice(0, 5)) {
      lines.push(`  - ${truncate(d.statement, 200)} (возраст ${d.ageDays} дн.).`);
    }
  }

  return lines.join('\n');
}

function pct(v: number): string {
  if (!Number.isFinite(v)) return '0%';
  return `${Math.round(v * 100)}%`;
}
function signed(v: number): string {
  if (v > 0) return `+${v}`;
  return String(v);
}
function truncate(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

async function main(): Promise<void> {
  console.log('=== Variant A — weekly-digest: код агрегирует, LLM пишет markdown ===');
  const raw = JSON.parse(await fs.readFile(AGGREGATE_PATH, 'utf-8'));
  const agg: Aggregate = raw.aggregate;
  const userMessage = buildUserMessage(agg);
  console.log(
    `  агрегат: ${agg.totalCheckIns} чек-инов, ${agg.topBlockers.length} блокеров, ${agg.topInsights.length} инсайтов`,
  );
  console.log(
    `  вход (user-msg): ${userMessage.length} знаков (≈${Math.round(userMessage.length / 4)} токенов)`,
  );
  console.log('  → запрос…');

  const start = Date.now();
  let usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
    cached_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  } = {};
  let markdown = '';
  let error: string | undefined;

  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 4000,
    } as Parameters<typeof client.chat.completions.create>[0])) as unknown as {
      choices: Array<{ message?: { content?: string | null } }>;
      usage?: typeof usage;
    };
    usage = resp.usage ?? {};
    markdown = resp.choices[0]?.message?.content ?? '';
    if (!markdown) error = 'модель вернула пустой content';
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const ms = Date.now() - start;
  const tokensIn = usage.prompt_tokens ?? 0;
  const tokensOut = usage.completion_tokens ?? 0;
  const cached =
    usage.prompt_cache_hit_tokens ??
    usage.cached_tokens ??
    usage.prompt_tokens_details?.cached_tokens ??
    0;
  const uncached = Math.max(0, tokensIn - cached);
  const cost = uncached * PRICE_IN + cached * PRICE_CACHED_IN + tokensOut * PRICE_OUT;

  console.log(
    `\n  ${error ? '✗' : '✓'} ${ms} мс | вход=${tokensIn} (кэш=${cached}) выход=${tokensOut} | $${cost.toFixed(4)}${error ? ` | ${error}` : ''}`,
  );
  console.log(`  markdown: ${markdown.length} знаков, ${countWords(markdown)} слов`);

  await fs.writeFile(REPORT_MD, markdown, 'utf-8');
  await fs.writeFile(
    REPORT_JSON,
    JSON.stringify(
      {
        variant: 'A',
        hypothesis: 'weekly-digest: код агрегирует, LLM пишет markdown',
        fixtureId: raw.fixtureId,
        model: MODEL,
        totalMs: ms,
        totalTokensIn: tokensIn,
        totalTokensOut: tokensOut,
        totalCachedTokens: cached,
        totalCostUsd: cost,
        markdownChars: markdown.length,
        markdownWords: countWords(markdown),
        markdown,
        userMessageChars: userMessage.length,
        error,
      },
      null,
      2,
    ),
    'utf-8',
  );
  console.log(`\n✓ markdown: ${REPORT_MD}`);
  console.log(`✓ метрики: ${REPORT_JSON}`);
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

main().catch((e) => {
  console.error('\n✗ FATAL:', e);
  process.exit(1);
});
