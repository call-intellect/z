import { promises as fs } from 'fs';
import path from 'path';

const FIXTURE_ID = process.argv[2] ?? 'fixture-01-pilot';
const MODEL = process.env.JUDGE_MODEL ?? 'claude-opus-4-7';

const PRICE_IN_PER_TOKEN = 1.425 / 1_000_000;
const PRICE_OUT_PER_TOKEN = 7.15 / 1_000_000;

const FIXTURE_PATH = path.resolve(`test/eval/sales-merge-experiment/fixtures/${FIXTURE_ID}.json`);
const A_PATH = path.resolve(
  `test/eval/sales-merge-experiment/reports/${FIXTURE_ID}-variant-a.json`,
);
const B_PATH = path.resolve(
  `test/eval/sales-merge-experiment/reports/${FIXTURE_ID}-variant-b.json`,
);
const SUMMARY_PATH = path.resolve(
  `test/eval/sales-merge-experiment/reports/${FIXTURE_ID}-SUMMARY.md`,
);
const RAW_PATH = path.resolve(
  `test/eval/sales-merge-experiment/reports/${FIXTURE_ID}-judge-raw.json`,
);

const KIE_API_KEY = process.env.KIE_API_KEY;
const KIE_BASE_URL = (process.env.KIE_BASE_URL ?? 'https://api.kie.ai').replace(/\/+$/, '');

if (!KIE_API_KEY) {
  console.error('✗ KIE_API_KEY не задан в backend/.env');
  process.exit(1);
}

interface NormalizedOutput {
  chapters: Array<{ title: string; summary: string; startMs?: number; endMs?: number }>;
  tasks: Array<{
    title: string;
    assigneeRaw?: string | null;
    dueDateIso?: string | null;
    confidence?: number;
    sourceQuote?: string;
  }>;
  summary_markdown: string;
  quality_score: {
    overallScore: number;
    categories: Record<string, number>;
    recommendations: Array<{ text: string; severity: string; category: string }>;
    strengths: string[];
  };
}

function normalizeA(aReport: {
  steps: Array<{ step: string; output?: unknown }>;
}): NormalizedOutput {
  const findStep = (key: string): unknown =>
    aReport.steps.find((s) => s.step.includes(key))?.output;
  const chaptersOut = findStep('chapters-v2') as { chapters?: NormalizedOutput['chapters'] };
  const tasksOut = findStep('tasks-v2') as { tasks?: NormalizedOutput['tasks'] };
  const summaryOut = findStep('summary-v2');
  const qualityOut = findStep('meeting-quality-score') as NormalizedOutput['quality_score'];
  return {
    chapters: chaptersOut?.chapters ?? [],
    tasks: tasksOut?.tasks ?? [],
    summary_markdown: typeof summaryOut === 'string' ? summaryOut : '',
    quality_score: qualityOut ?? {
      overallScore: 0,
      categories: {},
      recommendations: [],
      strengths: [],
    },
  };
}

function normalizeB(bReport: { output: unknown }): NormalizedOutput {
  const out = bReport.output as Partial<NormalizedOutput> & {
    summary_markdown?: string;
  };
  return {
    chapters: out.chapters ?? [],
    tasks: out.tasks ?? [],
    summary_markdown: out.summary_markdown ?? '',
    quality_score: out.quality_score ?? {
      overallScore: 0,
      categories: {},
      recommendations: [],
      strengths: [],
    },
  };
}

const JUDGE_INSTRUCTIONS = `Ты — независимый эксперт-аналитик деловых встреч. Тебе дают:
1. Транскрипт продажной встречи (сырой текст).
2. Список ожидаемых фактов (которые ДОЛЖНЫ быть в выводе хорошего анализа).
3. Два разных AI-анализа этой встречи: вариант X и вариант Y.

Ты НЕ знаешь, какая система их сгенерировала. Имена X/Y — случайные.

Оцени каждый вариант по 4 критериям шкалой 1-5 (5 = отлично, 1 = плохо):

1. **chapters_quality** — главы: правильность разбиения по смыслу, точность таймкодов, отсутствие пропусков и пересечений, понятность названий.
2. **tasks_accuracy** — задачи: только реальные явные поручения (не пожелания), правильный исполнитель и срок, цитата подтверждает.
3. **summary_quality** — резюме: покрывает все expectedFacts, нет галлюцинаций, структурировано по нужным разделам для sales-встречи.
4. **quality_score_correctness** — оценка качества: адекватный общий балл, рекомендации действенные (не диагнозы), сильные стороны соответствуют встрече.

Будь строгим: 5 ставь только если действительно отлично, без замечаний. Различай реальные ошибки от стилистических предпочтений.

ВЕРНИ СТРОГО ВАЛИДНЫЙ JSON по этой схеме (без markdown-обрамления, без преамбулы, без объяснений сверх JSON):

{
  "chapters": { "score_x": 1-5, "score_y": 1-5, "explain": "1-2 предложения" },
  "tasks":    { "score_x": 1-5, "score_y": 1-5, "explain": "..." },
  "summary":  { "score_x": 1-5, "score_y": 1-5, "explain": "..." },
  "quality_score": { "score_x": 1-5, "score_y": 1-5, "explain": "..." },
  "winner_overall": "X" | "Y" | "tie",
  "reasoning": "2-3 предложения общего вывода"
}`;

async function callClaudeViaKie(prompt: string): Promise<{
  text: string;
  inputTokens: number;
  outputTokens: number;
  ms: number;
}> {
  const url = `${KIE_BASE_URL}/claude/v1/messages`;
  const body = {
    model: MODEL,
    max_tokens: 16000,
    stream: false,
    messages: [{ role: 'user', content: prompt }],
  };
  const start = Date.now();
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${KIE_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - start;
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`KIE ${resp.status}: ${errText.slice(0, 500)}`);
  }
  const data = (await resp.json()) as {
    content?: Array<{ type?: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = (data.content ?? [])
    .filter((b) => b?.type === 'text')
    .map((b) => b.text ?? '')
    .join('');
  return {
    text,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
    ms,
  };
}

function extractJson(text: string): unknown {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fenceMatch && fenceMatch[1]) {
    cleaned = fenceMatch[1].trim();
  }
  return JSON.parse(cleaned);
}

async function main(): Promise<void> {
  console.log(`=== Судья (KIE+${MODEL}): ${FIXTURE_ID} ===\n`);

  const fixture = JSON.parse(await fs.readFile(FIXTURE_PATH, 'utf-8'));
  const aReport = JSON.parse(await fs.readFile(A_PATH, 'utf-8'));
  const bReport = JSON.parse(await fs.readFile(B_PATH, 'utf-8'));

  const aNorm = normalizeA(aReport);
  const bNorm = normalizeB(bReport);

  const aIsX = Math.random() < 0.5;
  const xOutput = aIsX ? aNorm : bNorm;
  const yOutput = aIsX ? bNorm : aNorm;
  const xLabel = aIsX ? 'A' : 'B';
  const yLabel = aIsX ? 'B' : 'A';
  console.log(`  Маскировка: X = вариант ${xLabel}, Y = вариант ${yLabel} (скрыто от судьи)\n`);

  const prompt = `${JUDGE_INSTRUCTIONS}

# Транскрипт встречи (сырой)

${fixture.transcript}

# Ожидаемые факты

${(fixture.meta.expectedFacts as string[]).map((f, i) => `${i + 1}. ${f}`).join('\n')}

# Вариант X

\`\`\`json
${JSON.stringify(xOutput, null, 2)}
\`\`\`

# Вариант Y

\`\`\`json
${JSON.stringify(yOutput, null, 2)}
\`\`\`

Верни строго валидный JSON, как описано в инструкции выше. Никаких преамбул, никакого markdown-обрамления.`;

  console.log(`  → запрос Claude через KIE…`);
  let result: Awaited<ReturnType<typeof callClaudeViaKie>>;
  try {
    result = await callClaudeViaKie(prompt);
  } catch (e) {
    console.error(`  ✗ KIE error: ${(e as Error).message}`);
    process.exit(1);
  }
  const judgeCostUsd =
    result.inputTokens * PRICE_IN_PER_TOKEN + result.outputTokens * PRICE_OUT_PER_TOKEN;
  console.log(
    `  ✓ ${result.ms} мс | вход=${result.inputTokens} выход=${result.outputTokens} | $${judgeCostUsd.toFixed(4)}\n`,
  );

  await fs.writeFile(
    RAW_PATH,
    JSON.stringify({ model: MODEL, ...result, xLabel, yLabel }, null, 2),
    'utf-8',
  );

  let j: {
    chapters: { score_x: number; score_y: number; explain: string };
    tasks: { score_x: number; score_y: number; explain: string };
    summary: { score_x: number; score_y: number; explain: string };
    quality_score: { score_x: number; score_y: number; explain: string };
    winner_overall: 'X' | 'Y' | 'tie';
    reasoning: string;
  };
  try {
    j = extractJson(result.text) as typeof j;
  } catch (e) {
    console.error(`  ✗ JSON parse: ${(e as Error).message}`);
    console.error(`     raw text сохранён в ${RAW_PATH}`);
    process.exit(1);
  }

  const scoreFor = (label: 'A' | 'B', crit: { score_x: number; score_y: number }): number =>
    label === xLabel ? crit.score_x : crit.score_y;
  const explainNormalized = (text: string): string =>
    text
      .replace(/\bВариант X\b/g, `Вариант ${xLabel}`)
      .replace(/\bВариант Y\b/g, `Вариант ${yLabel}`)
      .replace(/\bX:\s/g, `${xLabel}: `)
      .replace(/\bY:\s/g, `${yLabel}: `);
  const reasoningNorm = explainNormalized(j.reasoning);
  const winnerReal =
    j.winner_overall === 'tie' ? 'tie' : j.winner_overall === 'X' ? xLabel : yLabel;

  const md = `# Сравнение Variant A vs Б — ${FIXTURE_ID}

Дата: ${new Date().toISOString()}
Модели: Variant A/Б — deepseek-v4-pro · Судья — ${MODEL} (через KIE)
Фикстура: ${fixture.scenario}

## Цифровые метрики

| Метрика | Variant A (5 раздельных шагов) | Variant Б (1 объединённый) | Выигрыш Б |
|---|---|---|---|
| Время | ${(aReport.totalMs / 1000).toFixed(1)} с | ${(bReport.totalMs / 1000).toFixed(1)} с | в ${(aReport.totalMs / bReport.totalMs).toFixed(1)}× быстрее |
| Стоимость | $${aReport.totalCostUsd.toFixed(4)} | $${bReport.totalCostUsd.toFixed(4)} | в ${(aReport.totalCostUsd / bReport.totalCostUsd).toFixed(1)}× дешевле |
| Кол-во вызовов | 5 | 1 | — |
| Извлеч. блоков | ${aReport.ingestedBlocksCount ?? '—'} | (нет block-ingest) | — |

## Сводка выходов

| Секция | Variant A | Variant Б |
|---|---|---|
| chapters | ${aNorm.chapters.length} шт | ${bNorm.chapters.length} шт |
| tasks | ${aNorm.tasks.length} шт | ${bNorm.tasks.length} шт |
| summary_markdown | ${aNorm.summary_markdown.length} знаков | ${bNorm.summary_markdown.length} знаков |
| overallScore | ${aNorm.quality_score.overallScore} | ${bNorm.quality_score.overallScore} |

## Вердикт судьи (${MODEL}, метки скрыты)

**Победитель: ${winnerReal === 'tie' ? 'ничья' : `Variant ${winnerReal}`}**

> ${reasoningNorm}

### По критериям (5 = отлично, 1 = плохо)

| Критерий | Variant A | Variant Б | Объяснение судьи |
|---|---|---|---|
| Главы | ${scoreFor('A', j.chapters)} | ${scoreFor('B', j.chapters)} | ${explainNormalized(j.chapters.explain)} |
| Задачи | ${scoreFor('A', j.tasks)} | ${scoreFor('B', j.tasks)} | ${explainNormalized(j.tasks.explain)} |
| Резюме | ${scoreFor('A', j.summary)} | ${scoreFor('B', j.summary)} | ${explainNormalized(j.summary.explain)} |
| Оценка качества | ${scoreFor('A', j.quality_score)} | ${scoreFor('B', j.quality_score)} | ${explainNormalized(j.quality_score.explain)} |

### Сумма баллов
- Variant A: ${scoreFor('A', j.chapters) + scoreFor('A', j.tasks) + scoreFor('A', j.summary) + scoreFor('A', j.quality_score)} / 20
- Variant Б: ${scoreFor('B', j.chapters) + scoreFor('B', j.tasks) + scoreFor('B', j.summary) + scoreFor('B', j.quality_score)} / 20

## Метаданные эксперимента

- Маскировка: X = вариант ${xLabel}, Y = вариант ${yLabel}.
- Судья: ${MODEL}, вход=${result.inputTokens} токенов, выход=${result.outputTokens} токенов, стоимость $${judgeCostUsd.toFixed(4)}, время ${(result.ms / 1000).toFixed(1)} с.
`;

  await fs.writeFile(SUMMARY_PATH, md, 'utf-8');
  console.log(`=== Итог ===`);
  console.log(`  Победитель: ${winnerReal === 'tie' ? 'ничья' : `Variant ${winnerReal}`}`);
  console.log(
    `  A=${scoreFor('A', j.chapters) + scoreFor('A', j.tasks) + scoreFor('A', j.summary) + scoreFor('A', j.quality_score)} / Б=${scoreFor('B', j.chapters) + scoreFor('B', j.tasks) + scoreFor('B', j.summary) + scoreFor('B', j.quality_score)} (из 20)`,
  );
  console.log(`  Резоны: ${reasoningNorm}`);
  console.log(`\n✓ отчёт: ${SUMMARY_PATH}`);
}

main().catch((e) => {
  console.error('\n✗ FATAL:', e);
  process.exit(1);
});
