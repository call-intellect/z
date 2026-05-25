/**
 * Гипотеза 2, Variant A — текущая архитектура: 1 чек-ин = 1 вызов.
 * Реалистичная нагрузка: 25 чек-инов через event-loop = 25 параллельных вызовов.
 *
 * Источник промпта: backend/src/modules/operations/prompts/checkin-sentiment.prompt.ts
 *
 * Метрики: цена за чек-ин, время на батч (параллельно), точность vs expectedSentiment.
 *
 * Запуск: cd backend && bun run scripts/eval/run-checkin-single.ts
 */
import { promises as fs } from 'fs';
import path from 'path';
import OpenAI from 'openai';

const MODEL = 'deepseek-v4-pro';
const PRICE_IN = 0.435 / 1_000_000;
const PRICE_CACHED_IN = 0.003625 / 1_000_000;
const PRICE_OUT = 0.87 / 1_000_000;
// ВАЖНО: на DeepSeek-Pro thinking-токены входят в output. Текущий код в
// checkin-sentiment-analyzer.worker.ts ставит 300 — этого МАЛО (~56% ответов
// пустые). Поднимаем до 2000 для корректного сравнения с batch.
const MAX_TOKENS = 2000;
const PARALLEL = 5; // лимит одновременных запросов чтобы не схватить 429

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]):/, '$1:');
const CHECKINS_PATH = path.resolve(SCRIPT_DIR, '../../test/eval/operations-experiment/fixtures/checkins-week.json');
const REPORT_PATH = path.resolve(SCRIPT_DIR, '../../test/eval/operations-experiment/reports/variant-a-checkin-single.json');

if (!process.env.DEEPSEEK_API_KEY) {
  console.error('✗ DEEPSEEK_API_KEY не задан');
  process.exit(1);
}
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
});

// ── system-промпт (копия из checkin-sentiment.prompt.ts) ─────────────────────
const SYSTEM_PROMPT = [
  'Ты — внимательный читатель ежедневных вечерних чек-инов сотрудников.',
  'Тебе дают короткий свободный текст (что человек сделал за день, что мешает, как ощущения).',
  'Твоя задача — определить общее настроение чек-ина одним из трёх значений:',
  '  - "green" — день прошёл нормально или хорошо: задачи закрыты, тон спокойный, блокеров нет или они мелкие.',
  '  - "yellow" — есть напряжение: часть задач не закрыта, есть блокеры или раздражение, но в целом ситуация управляемая.',
  '  - "red" — серьёзные проблемы: ничего не сделано, сильное выгорание, конфликт, явная просьба о помощи, упоминание увольнения, переработки несколько дней подряд.',
  '',
  'Ответ возвращай строго в формате JSON: {"sentiment":"green|yellow|red","rationale":"короткое обоснование на русском, до 200 символов"}.',
  'Никакого комментария вне JSON. rationale — не цитата сотрудника, а короткое объяснение твоего вывода для администратора.',
  'Если текст пустой, бессмысленный или односложный («ок», «всё хорошо») — sentiment="green", rationale="мало деталей, явных проблем нет".',
].join('\n');

function buildUserMessage(kind: 'morning' | 'evening', rawText: string): string {
  const kindLabel =
    kind === 'evening'
      ? 'вечерний (что сделано + блокеры + ощущения)'
      : 'утренний (план на день)';
  return [
    `Тип чек-ина: ${kindLabel}.`,
    'Текст сотрудника:',
    (rawText ?? '').slice(0, 4_000),
  ].join('\n');
}

interface CheckIn {
  id: string;
  personName: string;
  date: string;
  kind: 'morning' | 'evening';
  rawText: string;
  expectedSentiment: 'green' | 'yellow' | 'red';
  expectedRationaleNote: string;
}

interface CallReport {
  checkInId: string;
  expected: 'green' | 'yellow' | 'red';
  predicted: 'green' | 'yellow' | 'red' | null;
  correct: boolean;
  rationale: string;
  ms: number;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  costUsd: number;
  error?: string;
}

async function callOne(checkin: CheckIn): Promise<CallReport> {
  const start = Date.now();
  let usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
    cached_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  } = {};
  let predicted: 'green' | 'yellow' | 'red' | null = null;
  let rationale = '';
  let error: string | undefined;

  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserMessage(checkin.kind, checkin.rawText) },
      ],
      max_tokens: MAX_TOKENS,
      response_format: { type: 'json_object' },
    } as Parameters<typeof client.chat.completions.create>[0])) as unknown as {
      choices: Array<{ message?: { content?: string | null } }>;
      usage?: typeof usage;
    };
    usage = resp.usage ?? {};
    const content = resp.choices[0]?.message?.content ?? '';
    const parsed = parseJson(content);
    if (parsed) {
      predicted = parsed.sentiment;
      rationale = parsed.rationale;
    } else {
      error = `невалидный JSON: ${content.slice(0, 100)}`;
    }
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

  return {
    checkInId: checkin.id,
    expected: checkin.expectedSentiment,
    predicted,
    correct: predicted === checkin.expectedSentiment,
    rationale,
    ms,
    tokensIn,
    tokensOut,
    cachedTokens: cached,
    costUsd: cost,
    error,
  };
}

function parseJson(
  text: string,
): { sentiment: 'green' | 'yellow' | 'red'; rationale: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (o.sentiment !== 'green' && o.sentiment !== 'yellow' && o.sentiment !== 'red') return null;
  return {
    sentiment: o.sentiment,
    rationale: typeof o.rationale === 'string' ? o.rationale.slice(0, 1000) : '',
  };
}

async function runWithConcurrency<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  limit: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  async function next(): Promise<void> {
    while (true) {
      const current = idx++;
      if (current >= items.length) return;
      results[current] = await worker(items[current]!);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => next());
  await Promise.all(workers);
  return results;
}

async function main(): Promise<void> {
  console.log('=== Variant A — checkin-sentiment SINGLE (1 чек-ин = 1 вызов) ===');
  const raw = JSON.parse(await fs.readFile(CHECKINS_PATH, 'utf-8'));
  const checkins: CheckIn[] = raw.checkins;
  console.log(`  чек-инов: ${checkins.length}, параллелизм: ${PARALLEL}`);
  console.log('  → запросы…');

  const totalStart = Date.now();
  const reports = await runWithConcurrency(checkins, callOne, PARALLEL);
  const totalMs = Date.now() - totalStart;

  // Сводка
  const ok = reports.filter((r) => r.predicted !== null);
  const fails = reports.filter((r) => r.error);
  const correct = reports.filter((r) => r.correct).length;
  const accuracy = ok.length > 0 ? correct / reports.length : 0;
  const totalCost = reports.reduce((s, r) => s + r.costUsd, 0);
  const totalIn = reports.reduce((s, r) => s + r.tokensIn, 0);
  const totalOut = reports.reduce((s, r) => s + r.tokensOut, 0);
  const totalCached = reports.reduce((s, r) => s + r.cachedTokens, 0);
  const avgMs = reports.reduce((s, r) => s + r.ms, 0) / reports.length;

  console.log('\n=== Итоги ===');
  console.log(`  суммарное время (параллельно): ${(totalMs / 1000).toFixed(1)} с`);
  console.log(`  среднее время на вызов:         ${avgMs.toFixed(0)} мс`);
  console.log(`  токены: вход=${totalIn} (кэш=${totalCached}) выход=${totalOut}`);
  console.log(`  стоимость суммарно:             $${totalCost.toFixed(4)}`);
  console.log(`  стоимость за чек-ин:            $${(totalCost / checkins.length).toFixed(4)}`);
  console.log(`  точность:                       ${correct}/${reports.length} (${(accuracy * 100).toFixed(0)}%)`);
  if (fails.length > 0) console.log(`  ошибок: ${fails.length}`);

  // Confusion-таблица
  console.log('\n=== Confusion (expected → predicted) ===');
  const cf: Record<string, Record<string, number>> = { green: {}, yellow: {}, red: {} };
  for (const r of reports) {
    const pred = r.predicted ?? 'ERR';
    cf[r.expected]![pred] = (cf[r.expected]![pred] ?? 0) + 1;
  }
  for (const exp of ['green', 'yellow', 'red']) {
    const row = cf[exp]!;
    console.log(`  ${exp}: ${JSON.stringify(row)}`);
  }

  await fs.writeFile(
    REPORT_PATH,
    JSON.stringify(
      {
        variant: 'A',
        hypothesis: 'checkin-sentiment: 1 чек-ин = 1 вызов',
        fixtureId: raw.fixtureId,
        model: MODEL,
        parallel: PARALLEL,
        totalMs,
        avgMsPerCall: avgMs,
        totalTokensIn: totalIn,
        totalTokensOut: totalOut,
        totalCachedTokens: totalCached,
        totalCostUsd: totalCost,
        costPerCheckin: totalCost / checkins.length,
        accuracy,
        correctCount: correct,
        totalCount: reports.length,
        failsCount: fails.length,
        confusion: cf,
        reports,
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
