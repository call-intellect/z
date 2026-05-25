/**
 * Контрольный эксперимент: ЕСТЬ ли у DeepSeek-V4-Pro «потолок» кэшируемого
 * префикса (~2700 токенов), или это эффект параллельных вызовов с разными
 * tool-схемами (как в эксп.3 Variant Г).
 *
 * Запуск (из backend):
 *   bun run scripts/eval/probe-deepseek-cache.ts
 *
 * 3 сценария:
 *   S1 (sequential identical):  для каждого N токенов делаем 2 ИДЕНТИЧНЫХ
 *       последовательных запроса. На 2-м должен быть cached_tokens ≈ N − 64.
 *       Если есть потолок 2700 — увидим plateau cached ≈ 2700 при N ≥ 2700.
 *
 *   S2 (parallel identical):    8 одинаковых запросов в Promise.all на одном
 *       размере (~10k токенов). Воспроизводит условия Variant Г без разных
 *       tool-схем. Покажет, насколько cache hit падает из-за параллельности.
 *
 *   S3 (sequential variable tail): тот же N, но user в конце дописываем
 *       уникальный suffix. На 2-м должен быть cached ≈ N − (длина суффикса)
 *       − 64. Доказательство того, что кэш покрывает префикс до первого
 *       расхождения.
 *
 * Метрики: prompt_tokens, cached_tokens, completion_tokens, latency_ms.
 *
 * Бюджет: ≈ $0.10 при ценах со скидкой ($0.435/M in, $0.003625/M cached,
 * $0.87/M out).
 *
 * Параметры:
 *   модель — deepseek-v4-pro
 *   baseURL — прямой api.deepseek.com/v1 (БЕЗ прокси, по согласованию)
 *   max_tokens=80 (минимум чтобы Pro+thinking успело ответить)
 */
import { promises as fs } from 'fs';
import path from 'path';
import OpenAI from 'openai';
import 'dotenv/config';

const MODEL = process.env.DEEPSEEK_CACHE_MODEL ?? 'deepseek-v4-pro';
const PRICE_IN = 0.435 / 1_000_000;
const PRICE_CACHED_IN = 0.003625 / 1_000_000;
const PRICE_OUT = 0.87 / 1_000_000;
const MAX_TOKENS = 80;

const SCRIPT_DIR = path
  .dirname(new URL(import.meta.url).pathname)
  .replace(/^\/([A-Za-z]):/, '$1:');
const REPORTS_DIR = path.resolve(
  SCRIPT_DIR,
  '../../test/eval/cache-experiment/reports',
);

if (!process.env.DEEPSEEK_API_KEY) {
  console.error('✗ DEEPSEEK_API_KEY не задан в backend/.env');
  process.exit(1);
}
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com/v1',
});

// ─── промпт-наполнитель ─────────────────────────────────────────────────────
// Длинный детерминированный русский текст. Повторяющиеся параграфы про
// процесс встречи Z — содержат смысл, чтобы модель не "схлопывала" по
// служебным признакам, но детерминированы для повторяемости.
const FILLER_PARAGRAPH = `
Встреча Z — это рабочая сессия команды, где обсуждаются текущие задачи и принимаются решения.
Каждая встреча имеет тип: продажная, внутренняя планёрка, ретроспектива, интервью, демо, обучение.
Тип встречи определяет шаблон AI-отчёта и набор сущностей, которые извлекает knowledge-инженер.
Запись ведётся через LiveKit — каждый участник получает отдельную аудиодорожку, что критично для последующего разделения по спикерам.
Транскрибация выполняется ASR-провайдером, разметка спикеров — отдельным этапом, формирование IdeaBlock-ов — серией LLM-вызовов.
IdeaBlock — это атомарная смысловая единица: имеет name, criticalQuestion, trustedAnswer и signalType.
Возможные signalType: decision, rationale, idea, feature_request, pain, risk, blocker, hypothesis, result, lesson, regulation, process_step, expertise, mentoring, fact, help_provided, proactive_hint, emotional_support, reasoning, methodology_step.
Каждый блок ссылается на исходные таймкоды и speakerId, что позволяет восстановить контекст и проверить факт.
Граф знаний компании строится поверх IdeaBlock-ов через EntityLink — связи между блоками и каноническими сущностями: персонами, проектами, продуктами, технологиями, метриками.
Темы кластеризуются автоматически через embedding-модель text-embedding-3-small, индекс хранится в pgvector с HNSW.
Поиск в графе — гибридный: семантическое сходство плюс точное совпадение по entity-связям плюс recency.
Это позволяет AI-чату компании отвечать на вопросы вида «что мы решили по тарификатору на последней планёрке» с привязкой к конкретным блокам.
`;

function buildText(targetChars: number): string {
  const parts: string[] = [];
  let total = 0;
  let i = 0;
  while (total < targetChars) {
    const p = `[Параграф ${i + 1}]${FILLER_PARAGRAPH}`;
    parts.push(p);
    total += p.length;
    i += 1;
  }
  return parts.join('\n').slice(0, targetChars);
}

// ─── вызов и измерение ──────────────────────────────────────────────────────
interface CallResult {
  ok: boolean;
  ms: number;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  cacheHitRatio: number;
  costUsd: number;
  error?: string;
}

interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  cached_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

const SYSTEM_PROMPT =
  'Ты — ассистент. Отвечай ровно одним словом «ок» и ничего больше.';

async function callOnce(userText: string): Promise<CallResult> {
  const start = Date.now();
  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userText },
      ],
      max_tokens: MAX_TOKENS,
    } as Parameters<typeof client.chat.completions.create>[0])) as unknown as {
      usage?: Usage;
    };
    const ms = Date.now() - start;
    const u = resp.usage ?? {};
    const promptTokens = u.prompt_tokens ?? 0;
    const completionTokens = u.completion_tokens ?? 0;
    const cachedTokens =
      u.prompt_cache_hit_tokens ??
      u.cached_tokens ??
      u.prompt_tokens_details?.cached_tokens ??
      0;
    const uncached = Math.max(0, promptTokens - cachedTokens);
    const costUsd =
      uncached * PRICE_IN +
      cachedTokens * PRICE_CACHED_IN +
      completionTokens * PRICE_OUT;
    return {
      ok: true,
      ms,
      promptTokens,
      cachedTokens,
      completionTokens,
      cacheHitRatio: promptTokens > 0 ? cachedTokens / promptTokens : 0,
      costUsd,
    };
  } catch (e) {
    return {
      ok: false,
      ms: Date.now() - start,
      promptTokens: 0,
      cachedTokens: 0,
      completionTokens: 0,
      cacheHitRatio: 0,
      costUsd: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// Размер промпта в символах для каждого target prompt_tokens (русский ≈ 2.8 ch/tok).
// После первого вызова откалибруем точнее.
const TARGET_TOKENS = [256, 1024, 2048, 2700, 3500, 5000, 10000, 20000, 50000];
let CHARS_PER_TOKEN = 2.8;

function fmt(n: number, w: number = 7): string {
  return String(n).padStart(w);
}
function pct(x: number): string {
  return (x * 100).toFixed(1).padStart(5) + '%';
}

// ─── сценарии ───────────────────────────────────────────────────────────────

interface S1Row {
  targetTokens: number;
  attempt: 1 | 2;
  promptTokens: number;
  cachedTokens: number;
  cacheHitRatio: number;
  completionTokens: number;
  ms: number;
  costUsd: number;
}

async function scenarioS1(): Promise<S1Row[]> {
  console.log('\n═══ S1: sequential identical (потолок vs нет потолка) ═══');
  console.log(
    'target_tok | actual_tok | cached_1 | cached_2 | hit_2 % | ms_1 | ms_2',
  );
  console.log('-'.repeat(74));
  const rows: S1Row[] = [];
  for (const target of TARGET_TOKENS) {
    const userText = buildText(Math.round(target * CHARS_PER_TOKEN));
    const r1 = await callOnce(userText);
    if (!r1.ok) {
      console.log(`  ${target.toString().padStart(5)}: ✗ ${r1.error}`);
      continue;
    }
    // калибруем chars/token по факту первого реального ответа
    if (target === TARGET_TOKENS[0]) {
      CHARS_PER_TOKEN = userText.length / Math.max(1, r1.promptTokens) * 1.02; // 2% буфер
    }
    const r2 = await callOnce(userText);
    if (!r2.ok) {
      console.log(`  ${target.toString().padStart(5)}: ✗ (2nd) ${r2.error}`);
      continue;
    }
    rows.push({
      targetTokens: target,
      attempt: 1,
      promptTokens: r1.promptTokens,
      cachedTokens: r1.cachedTokens,
      cacheHitRatio: r1.cacheHitRatio,
      completionTokens: r1.completionTokens,
      ms: r1.ms,
      costUsd: r1.costUsd,
    });
    rows.push({
      targetTokens: target,
      attempt: 2,
      promptTokens: r2.promptTokens,
      cachedTokens: r2.cachedTokens,
      cacheHitRatio: r2.cacheHitRatio,
      completionTokens: r2.completionTokens,
      ms: r2.ms,
      costUsd: r2.costUsd,
    });
    console.log(
      `${fmt(target)}    | ${fmt(r1.promptTokens)}    | ${fmt(r1.cachedTokens)}  | ${fmt(r2.cachedTokens)}  | ${pct(r2.cacheHitRatio)} | ${fmt(r1.ms, 5)} | ${fmt(r2.ms, 5)}`,
    );
  }
  return rows;
}

interface S2Row {
  parallelIdx: number;
  promptTokens: number;
  cachedTokens: number;
  cacheHitRatio: number;
  completionTokens: number;
  ms: number;
  costUsd: number;
}

async function scenarioS2(warmupText?: string): Promise<S2Row[]> {
  console.log(
    '\n═══ S2: 8 parallel identical (повторяем Variant Г без разных схем) ═══',
  );
  const target = 10000;
  const userText =
    warmupText && warmupText.length > 0
      ? warmupText
      : buildText(Math.round(target * CHARS_PER_TOKEN));
  console.log(`8 параллельных запросов на ~${target} токенов (одинаковых)`);

  const results = await Promise.all(
    Array.from({ length: 8 }, () => callOnce(userText)),
  );
  console.log('idx | prompt | cached | hit %  | ms      ');
  console.log('-'.repeat(40));
  const rows: S2Row[] = [];
  results.forEach((r, i) => {
    if (!r.ok) {
      console.log(`  ${i}: ✗ ${r.error}`);
      return;
    }
    rows.push({
      parallelIdx: i,
      promptTokens: r.promptTokens,
      cachedTokens: r.cachedTokens,
      cacheHitRatio: r.cacheHitRatio,
      completionTokens: r.completionTokens,
      ms: r.ms,
      costUsd: r.costUsd,
    });
    console.log(
      ` ${i}  | ${fmt(r.promptTokens, 6)} | ${fmt(r.cachedTokens, 6)} | ${pct(r.cacheHitRatio)} | ${fmt(r.ms, 7)}`,
    );
  });
  const avgHit =
    rows.reduce((s, x) => s + x.cacheHitRatio, 0) / Math.max(1, rows.length);
  console.log(`  средний hit ratio: ${pct(avgHit)} (Variant Г было 21%)`);
  return rows;
}

interface S3Row {
  targetTokens: number;
  attempt: 1 | 2;
  tailLen: number;
  promptTokens: number;
  cachedTokens: number;
  cacheHitRatio: number;
  completionTokens: number;
  ms: number;
  costUsd: number;
}

async function scenarioS3(): Promise<S3Row[]> {
  console.log('\n═══ S3: sequential, переменный хвост (имитация прода) ═══');
  console.log(
    'Берём префикс N токенов + уникальный suffix (~50 токенов) в конце.',
  );
  console.log(
    'target_tok | actual_tok | cached_1 | cached_2 | hit_2 % | tail_len',
  );
  console.log('-'.repeat(74));
  const sizes = [2700, 10000, 20000];
  const rows: S3Row[] = [];
  for (const target of sizes) {
    const baseText = buildText(Math.round(target * CHARS_PER_TOKEN));
    const tail1 = `\n\n=== id=${Math.random().toString(36).slice(2)} ts=${Date.now()} ===`;
    const tail2 = `\n\n=== id=${Math.random().toString(36).slice(2)} ts=${Date.now()} ===`;
    const text1 = baseText + tail1;
    const text2 = baseText + tail2;
    const r1 = await callOnce(text1);
    const r2 = await callOnce(text2);
    if (!r1.ok || !r2.ok) {
      console.log(
        `  ${target}: ✗ ${r1.error ?? ''} ${r2.error ?? ''}`,
      );
      continue;
    }
    rows.push({
      targetTokens: target,
      attempt: 1,
      tailLen: tail1.length,
      promptTokens: r1.promptTokens,
      cachedTokens: r1.cachedTokens,
      cacheHitRatio: r1.cacheHitRatio,
      completionTokens: r1.completionTokens,
      ms: r1.ms,
      costUsd: r1.costUsd,
    });
    rows.push({
      targetTokens: target,
      attempt: 2,
      tailLen: tail2.length,
      promptTokens: r2.promptTokens,
      cachedTokens: r2.cachedTokens,
      cacheHitRatio: r2.cacheHitRatio,
      completionTokens: r2.completionTokens,
      ms: r2.ms,
      costUsd: r2.costUsd,
    });
    console.log(
      `${fmt(target)}    | ${fmt(r2.promptTokens)}    | ${fmt(r1.cachedTokens)}  | ${fmt(r2.cachedTokens)}  | ${pct(r2.cacheHitRatio)} | ${fmt(tail2.length, 8)}`,
    );
  }
  return rows;
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== DeepSeek-V4-Pro cache probe ===');
  console.log(`  модель:    ${MODEL}`);
  console.log(`  baseURL:   https://api.deepseek.com/v1 (без прокси)`);
  console.log(`  max_tokens: ${MAX_TOKENS}`);
  console.log(
    `  размеры:   ${TARGET_TOKENS.join(', ')} токенов (calibrated от первого ответа)`,
  );

  const startAll = Date.now();
  const s1 = await scenarioS1();
  const s2 = await scenarioS2();
  const s3 = await scenarioS3();
  const totalMs = Date.now() - startAll;

  // сводный анализ
  console.log('\n═══ АНАЛИЗ ═══');
  const s1Att2 = s1.filter((r) => r.attempt === 2);
  const maxCachedS1 = Math.max(...s1Att2.map((r) => r.cachedTokens), 0);
  const maxHitS1 = Math.max(...s1Att2.map((r) => r.cacheHitRatio), 0);
  console.log(`S1: max cached_tokens на 2-м запросе = ${maxCachedS1}`);
  console.log(`S1: max hit ratio = ${pct(maxHitS1)}`);
  if (maxCachedS1 > 5000) {
    console.log(
      `✓ Потолок ~2700 НЕ подтверждён — кэш покрывает >${maxCachedS1} токенов при идентичном префиксе.`,
    );
  } else {
    console.log(
      `? Кэш ограничен ${maxCachedS1} токенами — гипотеза про потолок подтверждена.`,
    );
  }

  // сохранить
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outJson = path.join(REPORTS_DIR, `probe-${ts}.json`);
  const outCsv = path.join(REPORTS_DIR, `probe-${ts}.csv`);
  await fs.writeFile(
    outJson,
    JSON.stringify(
      {
        model: MODEL,
        totalMs,
        scenarios: { S1: s1, S2: s2, S3: s3 },
      },
      null,
      2,
    ),
    'utf-8',
  );
  // CSV — плоско, для удобства анализа
  const csv: string[] = [
    'scenario,target_tokens,attempt_or_idx,tail_len,prompt_tokens,cached_tokens,cache_hit_ratio,completion_tokens,ms,cost_usd',
  ];
  for (const r of s1)
    csv.push(
      `S1,${r.targetTokens},${r.attempt},,${r.promptTokens},${r.cachedTokens},${r.cacheHitRatio.toFixed(4)},${r.completionTokens},${r.ms},${r.costUsd.toFixed(6)}`,
    );
  for (const r of s2)
    csv.push(
      `S2,10000,${r.parallelIdx},,${r.promptTokens},${r.cachedTokens},${r.cacheHitRatio.toFixed(4)},${r.completionTokens},${r.ms},${r.costUsd.toFixed(6)}`,
    );
  for (const r of s3)
    csv.push(
      `S3,${r.targetTokens},${r.attempt},${r.tailLen},${r.promptTokens},${r.cachedTokens},${r.cacheHitRatio.toFixed(4)},${r.completionTokens},${r.ms},${r.costUsd.toFixed(6)}`,
    );
  await fs.writeFile(outCsv, csv.join('\n'), 'utf-8');

  const allRows = [...s1, ...s2, ...s3];
  const totalCost = allRows.reduce((s, r) => s + r.costUsd, 0);
  console.log(
    `\nВсего запросов: ${allRows.length} | время: ${totalMs} мс | стоимость: $${totalCost.toFixed(4)}`,
  );
  console.log(`\n✓ JSON: ${outJson}`);
  console.log(`✓ CSV:  ${outCsv}`);
}

main().catch((e) => {
  console.error('\n✗ FATAL:', e);
  process.exit(1);
});
