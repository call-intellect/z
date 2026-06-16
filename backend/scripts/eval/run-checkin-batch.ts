import { promises as fs } from 'fs';
import path from 'path';
import OpenAI from 'openai';

const MODEL = 'deepseek-v4-pro';
const PRICE_IN = 0.435 / 1_000_000;
const PRICE_CACHED_IN = 0.003625 / 1_000_000;
const PRICE_OUT = 0.87 / 1_000_000;
const MAX_TOKENS = 8000;
const BATCH_SIZE = 10;

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]):/, '$1:');
const CHECKINS_PATH = path.resolve(
  SCRIPT_DIR,
  '../../test/eval/operations-experiment/fixtures/checkins-week.json',
);
const REPORT_PATH = path.resolve(
  SCRIPT_DIR,
  '../../test/eval/operations-experiment/reports/variant-b-checkin-batch.json',
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
  'Ты — внимательный читатель ежедневных вечерних чек-инов сотрудников.',
  'Тебе дают список из N чек-инов (каждый — короткий свободный текст). Для КАЖДОГО определи общее настроение одним из трёх значений:',
  '  - "green" — день прошёл нормально или хорошо: задачи закрыты, тон спокойный, блокеров нет или они мелкие.',
  '  - "yellow" — есть напряжение: часть задач не закрыта, есть блокеры или раздражение, но в целом ситуация управляемая.',
  '  - "red" — серьёзные проблемы: ничего не сделано, сильное выгорание, конфликт, явная просьба о помощи, упоминание увольнения, переработки несколько дней подряд.',
  '',
  'ВАЖНО: оценивай каждый чек-ин САМОСТОЯТЕЛЬНО — не сравнивай между собой и не делай общий тон по неделе.',
  '',
  'Верни результат через инструмент submit_batch_sentiments. Каждый элемент массива — {checkInId, sentiment, rationale}.',
  'rationale — короткое (до 200 символов) обоснование на русском для администратора.',
  'Если текст пустой/бессмысленный/односложный — sentiment="green", rationale="мало деталей, явных проблем нет".',
].join('\n');

const TOOL = {
  type: 'function' as const,
  function: {
    name: 'submit_batch_sentiments',
    description: 'Отдать классификацию настроения для массива чек-инов.',
    parameters: {
      type: 'object',
      required: ['results'],
      additionalProperties: false,
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            required: ['checkInId', 'sentiment', 'rationale'],
            properties: {
              checkInId: { type: 'string' },
              sentiment: { type: 'string', enum: ['green', 'yellow', 'red'] },
              rationale: { type: 'string' },
            },
          },
        },
      },
    },
  },
};

interface CheckIn {
  id: string;
  personName: string;
  date: string;
  kind: 'morning' | 'evening';
  rawText: string;
  expectedSentiment: 'green' | 'yellow' | 'red';
  expectedRationaleNote: string;
}

interface BatchResult {
  checkInId: string;
  sentiment: 'green' | 'yellow' | 'red';
  rationale: string;
}

interface BatchReport {
  batchIndex: number;
  checkInIds: string[];
  ms: number;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  costUsd: number;
  results: BatchResult[];
  error?: string;
}

function buildUserMessage(batch: CheckIn[]): string {
  const lines: string[] = [];
  lines.push(`Классифицируй настроение для ${batch.length} вечерних чек-инов ниже.`);
  lines.push(
    'Каждый чек-ин помечен идентификатором [ID]. Верни результат через submit_batch_sentiments.',
  );
  lines.push('');
  for (const c of batch) {
    lines.push(`═══ [${c.id}] ═══`);
    lines.push((c.rawText ?? '').slice(0, 4_000));
    lines.push('');
  }
  return lines.join('\n');
}

async function callBatch(batch: CheckIn[], batchIndex: number): Promise<BatchReport> {
  const start = Date.now();
  let usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
    cached_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  } = {};
  let results: BatchResult[] = [];
  let error: string | undefined;

  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserMessage(batch) },
      ],
      max_tokens: MAX_TOKENS,
      tools: [TOOL],
      tool_choice: 'auto',
    } as Parameters<typeof client.chat.completions.create>[0])) as unknown as {
      choices: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{ function: { arguments: string } }>;
        };
      }>;
      usage?: typeof usage;
    };
    usage = resp.usage ?? {};
    const call = resp.choices[0]?.message?.tool_calls?.[0];
    if (!call) {
      error = 'модель не позвала tool';
    } else {
      try {
        const parsed = JSON.parse(call.function.arguments);
        if (Array.isArray(parsed.results)) {
          results = parsed.results;
        } else {
          error = 'results не массив';
        }
      } catch (e) {
        error = `JSON.parse: ${(e as Error).message}`;
      }
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
    batchIndex,
    checkInIds: batch.map((c) => c.id),
    ms,
    tokensIn,
    tokensOut,
    cachedTokens: cached,
    costUsd: cost,
    results,
    error,
  };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main(): Promise<void> {
  console.log('=== Variant Б — checkin-sentiment BATCH (10 чек-инов = 1 вызов) ===');
  const raw = JSON.parse(await fs.readFile(CHECKINS_PATH, 'utf-8'));
  const checkins: CheckIn[] = raw.checkins;
  const batches = chunk(checkins, BATCH_SIZE);
  console.log(
    `  чек-инов: ${checkins.length}, размер батча: ${BATCH_SIZE}, всего батчей: ${batches.length}`,
  );
  console.log('  → запросы (батчи параллельно)…');

  const totalStart = Date.now();
  const batchReports = await Promise.all(batches.map((b, i) => callBatch(b, i)));
  const totalMs = Date.now() - totalStart;

  const byId = new Map(checkins.map((c) => [c.id, c]));
  const evaluations: Array<{
    checkInId: string;
    expected: 'green' | 'yellow' | 'red';
    predicted: 'green' | 'yellow' | 'red' | null;
    rationale: string;
    correct: boolean;
  }> = [];
  for (const br of batchReports) {
    for (const r of br.results) {
      const c = byId.get(r.checkInId);
      if (!c) continue;
      evaluations.push({
        checkInId: r.checkInId,
        expected: c.expectedSentiment,
        predicted: r.sentiment,
        rationale: r.rationale,
        correct: r.sentiment === c.expectedSentiment,
      });
    }
  }
  const returnedIds = new Set(evaluations.map((e) => e.checkInId));
  for (const c of checkins) {
    if (!returnedIds.has(c.id)) {
      evaluations.push({
        checkInId: c.id,
        expected: c.expectedSentiment,
        predicted: null,
        rationale: '(не вернулось)',
        correct: false,
      });
    }
  }

  const totalCost = batchReports.reduce((s, b) => s + b.costUsd, 0);
  const totalIn = batchReports.reduce((s, b) => s + b.tokensIn, 0);
  const totalOut = batchReports.reduce((s, b) => s + b.tokensOut, 0);
  const totalCached = batchReports.reduce((s, b) => s + b.cachedTokens, 0);
  const correct = evaluations.filter((e) => e.correct).length;
  const accuracy = correct / evaluations.length;
  const fails = batchReports.filter((b) => b.error).length;

  console.log('\n=== Итоги ===');
  console.log(`  суммарное время (параллельно): ${(totalMs / 1000).toFixed(1)} с`);
  console.log(`  токены: вход=${totalIn} (кэш=${totalCached}) выход=${totalOut}`);
  console.log(`  стоимость суммарно:             $${totalCost.toFixed(4)}`);
  console.log(`  стоимость за чек-ин:            $${(totalCost / checkins.length).toFixed(4)}`);
  console.log(
    `  точность:                       ${correct}/${evaluations.length} (${(accuracy * 100).toFixed(0)}%)`,
  );
  if (fails > 0) console.log(`  упало батчей: ${fails}`);

  console.log('\n=== Confusion (expected → predicted) ===');
  const cf: Record<string, Record<string, number>> = { green: {}, yellow: {}, red: {} };
  for (const e of evaluations) {
    const pred = e.predicted ?? 'ERR';
    cf[e.expected]![pred] = (cf[e.expected]![pred] ?? 0) + 1;
  }
  for (const exp of ['green', 'yellow', 'red']) {
    console.log(`  ${exp}: ${JSON.stringify(cf[exp])}`);
  }

  await fs.writeFile(
    REPORT_PATH,
    JSON.stringify(
      {
        variant: 'B',
        hypothesis: 'checkin-sentiment: batch (10 per call)',
        fixtureId: raw.fixtureId,
        model: MODEL,
        batchSize: BATCH_SIZE,
        batches: batches.length,
        totalMs,
        totalTokensIn: totalIn,
        totalTokensOut: totalOut,
        totalCachedTokens: totalCached,
        totalCostUsd: totalCost,
        costPerCheckin: totalCost / checkins.length,
        accuracy,
        correctCount: correct,
        totalCount: evaluations.length,
        failsCount: fails,
        confusion: cf,
        batchReports,
        evaluations,
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
