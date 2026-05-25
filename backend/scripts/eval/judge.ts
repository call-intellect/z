/**
 * Судья сравнивает два варианта анализа одной встречи.
 *
 * Метки A/Б скрыты случайной маской X/Y, чтобы исключить позиционную
 * предвзятость. Судья — тот же DeepSeek-V4-Pro, отдельным вызовом.
 *
 * Запуск: cd backend && bun run scripts/eval/judge.ts
 */
import { promises as fs } from 'fs';
import path from 'path';
import OpenAI from 'openai';

const MODEL = 'deepseek-v4-pro';
// DeepSeek-V4-Pro со скидкой 75% (постоянная):
//   input miss $0.435/M, cache hit $0.003625/M, output $0.87/M.
const PRICE_IN = 0.435 / 1_000_000;
const PRICE_OUT = 0.87 / 1_000_000;

const FIXTURE_PATH = path.resolve(
  'test/eval/sales-merge-experiment/fixtures/fixture-01-pilot.json',
);
const A_PATH = path.resolve(
  'test/eval/sales-merge-experiment/reports/fixture-01-pilot-variant-a.json',
);
const B_PATH = path.resolve(
  'test/eval/sales-merge-experiment/reports/fixture-01-pilot-variant-b.json',
);
const SUMMARY_PATH = path.resolve(
  'test/eval/sales-merge-experiment/reports/SUMMARY.md',
);

if (!process.env.DEEPSEEK_API_KEY) {
  console.error('✗ DEEPSEEK_API_KEY не задан');
  process.exit(1);
}
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
});

// ── нормализация выходов A и Б к общему формату ─────────────────────────────

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
  const out = bReport.output as {
    chapters?: NormalizedOutput['chapters'];
    tasks?: NormalizedOutput['tasks'];
    summary_markdown?: string;
    quality_score?: NormalizedOutput['quality_score'];
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

// ── промпт судьи ─────────────────────────────────────────────────────────────

const JUDGE_SYSTEM = `Ты — независимый эксперт-аналитик деловых встреч. Тебе дают:
1. Транскрипт продажной встречи (сырой текст).
2. Список ожидаемых фактов (которые ДОЛЖНЫ быть в выводе хорошего анализа).
3. Два разных AI-анализа этой встречи: вариант X и вариант Y.

Ты НЕ знаешь, какая система их сгенерировала. Имена X/Y — случайные.

Оцени каждый вариант по 4 критериям шкалой 1-5 (5 = отлично, 1 = плохо):

1. **chapters_quality** — главы: правильность разбиения по смыслу, точность таймкодов, отсутствие пропусков и пересечений, понятность названий.
2. **tasks_accuracy** — задачи: только реальные явные поручения (не пожелания), правильный исполнитель и срок, цитата подтверждает.
3. **summary_quality** — резюме: покрывает все expectedFacts, нет галлюцинаций, структурировано по нужным разделам для sales-встречи.
4. **quality_score_correctness** — оценка качества: адекватный общий балл, рекомендации действенные (не диагнозы), сильные стороны соответствуют встрече.

Для каждого критерия дай:
- score_x (1-5) и score_y (1-5)
- explain — 1-2 предложения почему такие баллы

В итоге:
- winner_overall — "X" / "Y" / "tie"
- reasoning — 2-3 предложения общего вывода: какой вариант сильнее и в чём.

Будь строгим: 5 ставь только если действительно отлично, без замечаний. Различай реальные ошибки от стилистических предпочтений.

Верни результат через инструмент submit_judgement.`;

const JUDGE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'submit_judgement',
    description: 'Отдать сравнительную оценку двух вариантов анализа встречи.',
    parameters: {
      type: 'object',
      required: ['chapters', 'tasks', 'summary', 'quality_score', 'winner_overall', 'reasoning'],
      additionalProperties: false,
      properties: {
        chapters: {
          type: 'object',
          required: ['score_x', 'score_y', 'explain'],
          properties: {
            score_x: { type: 'integer', minimum: 1, maximum: 5 },
            score_y: { type: 'integer', minimum: 1, maximum: 5 },
            explain: { type: 'string' },
          },
        },
        tasks: {
          type: 'object',
          required: ['score_x', 'score_y', 'explain'],
          properties: {
            score_x: { type: 'integer', minimum: 1, maximum: 5 },
            score_y: { type: 'integer', minimum: 1, maximum: 5 },
            explain: { type: 'string' },
          },
        },
        summary: {
          type: 'object',
          required: ['score_x', 'score_y', 'explain'],
          properties: {
            score_x: { type: 'integer', minimum: 1, maximum: 5 },
            score_y: { type: 'integer', minimum: 1, maximum: 5 },
            explain: { type: 'string' },
          },
        },
        quality_score: {
          type: 'object',
          required: ['score_x', 'score_y', 'explain'],
          properties: {
            score_x: { type: 'integer', minimum: 1, maximum: 5 },
            score_y: { type: 'integer', minimum: 1, maximum: 5 },
            explain: { type: 'string' },
          },
        },
        winner_overall: { type: 'string', enum: ['X', 'Y', 'tie'] },
        reasoning: { type: 'string' },
      },
    },
  },
};

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== Судья: сравнение Variant A vs Б на fixture-01-pilot ===\n');

  const fixture = JSON.parse(await fs.readFile(FIXTURE_PATH, 'utf-8'));
  const aReport = JSON.parse(await fs.readFile(A_PATH, 'utf-8'));
  const bReport = JSON.parse(await fs.readFile(B_PATH, 'utf-8'));

  const aNorm = normalizeA(aReport);
  const bNorm = normalizeB(bReport);

  // ── случайная маскировка A/B → X/Y ──────────────────────────────────────────
  const aIsX = Math.random() < 0.5;
  const xOutput = aIsX ? aNorm : bNorm;
  const yOutput = aIsX ? bNorm : aNorm;
  const xLabel = aIsX ? 'A' : 'B';
  const yLabel = aIsX ? 'B' : 'A';
  console.log(`  Маскировка: X = вариант ${xLabel}, Y = вариант ${yLabel} (скрыто от судьи)\n`);

  const userMessage = `# Транскрипт встречи (сырой)

${fixture.transcript}

# Ожидаемые факты (что ДОЛЖНО быть в анализе)

${(fixture.meta.expectedFacts as string[]).map((f, i) => `${i + 1}. ${f}`).join('\n')}

# Вариант X

\`\`\`json
${JSON.stringify(xOutput, null, 2)}
\`\`\`

# Вариант Y

\`\`\`json
${JSON.stringify(yOutput, null, 2)}
\`\`\`

Оцени оба варианта по 4 критериям. Верни результат через инструмент submit_judgement.`;

  console.log(`  → запрос судье… (вход ≈ ${Math.round(userMessage.length / 4)} токенов)`);
  const start = Date.now();
  let usage: { prompt_tokens?: number; completion_tokens?: number } = {};
  let judgement: unknown;
  let error: string | undefined;

  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: JUDGE_SYSTEM },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 32000,
      tools: [JUDGE_TOOL],
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
      error = 'судья не позвал tool';
    } else {
      try {
        judgement = JSON.parse(call.function.arguments);
      } catch (parseErr) {
        // Дамп raw args для диагностики
        const dumpPath = path.resolve(
          'test/eval/sales-merge-experiment/reports/judge-raw-args.txt',
        );
        await fs.writeFile(dumpPath, call.function.arguments, 'utf-8');
        error = `JSON.parse: ${(parseErr as Error).message}. Raw args дамп: ${dumpPath} (${call.function.arguments.length} знаков)`;
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const ms = Date.now() - start;
  const tokensIn = usage.prompt_tokens ?? 0;
  const tokensOut = usage.completion_tokens ?? 0;
  const costUsd = tokensIn * PRICE_IN + tokensOut * PRICE_OUT;
  console.log(
    `  ${error ? '✗' : '✓'} ${ms} мс | вход=${tokensIn} выход=${tokensOut} | $${costUsd.toFixed(4)}${error ? ` | ${error}` : ''}\n`,
  );

  if (error) {
    console.error('Судья не отработал. Останавливаюсь.');
    process.exit(1);
  }

  // ── размаскирование: X → A/B, Y → A/B ──────────────────────────────────────
  const j = judgement as {
    chapters: { score_x: number; score_y: number; explain: string };
    tasks: { score_x: number; score_y: number; explain: string };
    summary: { score_x: number; score_y: number; explain: string };
    quality_score: { score_x: number; score_y: number; explain: string };
    winner_overall: 'X' | 'Y' | 'tie';
    reasoning: string;
  };

  const scoreFor = (label: 'A' | 'B', crit: { score_x: number; score_y: number }): number => {
    if (label === xLabel) return crit.score_x;
    return crit.score_y;
  };
  const winnerReal =
    j.winner_overall === 'tie'
      ? 'tie'
      : j.winner_overall === 'X'
        ? xLabel
        : yLabel;

  // ── SUMMARY.md ─────────────────────────────────────────────────────────────
  const aTotalCost = aReport.totalCostUsd;
  const bTotalCost = bReport.totalCostUsd;
  const aTotalMs = aReport.totalMs;
  const bTotalMs = bReport.totalMs;

  const md = `# Сравнение Variant A vs Б на fixture-01-pilot.json

Дата: ${new Date().toISOString()}
Модель: ${MODEL}
Фикстура: первая встреча продаж, высокий интерес, договорились о пилоте.

## Цифровые метрики

| Метрика | Variant A (5 раздельных шагов) | Variant Б (1 объединённый вызов) | Выигрыш Б |
|---|---|---|---|
| Время | ${(aTotalMs / 1000).toFixed(1)} с | ${(bTotalMs / 1000).toFixed(1)} с | в ${(aTotalMs / bTotalMs).toFixed(1)}× быстрее |
| Стоимость | $${aTotalCost.toFixed(4)} | $${bTotalCost.toFixed(4)} | в ${(aTotalCost / bTotalCost).toFixed(1)}× дешевле |
| Кол-во вызовов | 5 | 1 | — |
| Извлеч. блоков | ${aReport.ingestedBlocksCount} | (нет block-ingest) | — |

## Сводка выходов

| Секция | Variant A | Variant Б |
|---|---|---|
| chapters | ${aNorm.chapters.length} шт | ${bNorm.chapters.length} шт |
| tasks | ${aNorm.tasks.length} шт | ${bNorm.tasks.length} шт |
| summary_markdown | ${aNorm.summary_markdown.length} знаков | ${bNorm.summary_markdown.length} знаков |
| overallScore | ${aNorm.quality_score.overallScore} | ${bNorm.quality_score.overallScore} |

## Вердикт судьи (DeepSeek-V4-Pro, метки скрыты)

**Победитель: ${winnerReal === 'tie' ? 'ничья' : `Variant ${winnerReal}`}**

> ${j.reasoning}

### По критериям (5 = отлично, 1 = плохо)

| Критерий | Variant A | Variant Б | Объяснение судьи |
|---|---|---|---|
| Главы | ${scoreFor('A', j.chapters)} | ${scoreFor('B', j.chapters)} | ${j.chapters.explain} |
| Задачи | ${scoreFor('A', j.tasks)} | ${scoreFor('B', j.tasks)} | ${j.tasks.explain} |
| Резюме | ${scoreFor('A', j.summary)} | ${scoreFor('B', j.summary)} | ${j.summary.explain} |
| Оценка качества | ${scoreFor('A', j.quality_score)} | ${scoreFor('B', j.quality_score)} | ${j.quality_score.explain} |

### Сумма баллов
- Variant A: ${scoreFor('A', j.chapters) + scoreFor('A', j.tasks) + scoreFor('A', j.summary) + scoreFor('A', j.quality_score)} / 20
- Variant Б: ${scoreFor('B', j.chapters) + scoreFor('B', j.tasks) + scoreFor('B', j.summary) + scoreFor('B', j.quality_score)} / 20

## Метаданные эксперимента

- Маскировка: X = вариант ${xLabel}, Y = вариант ${yLabel}.
- Стоимость судьи: $${costUsd.toFixed(4)}, время ${(ms / 1000).toFixed(1)} с.
- Variant A: см. \`fixture-01-pilot-variant-a.json\`
- Variant Б: см. \`fixture-01-pilot-variant-b.json\`
`;

  await fs.writeFile(SUMMARY_PATH, md, 'utf-8');
  console.log(`\n=== Итог ===`);
  console.log(`  Победитель: ${winnerReal === 'tie' ? 'ничья' : `Variant ${winnerReal}`}`);
  console.log(`  Резоны судьи: ${j.reasoning}`);
  console.log(`\n✓ отчёт: ${SUMMARY_PATH}`);
}

main().catch((e) => {
  console.error('\n✗ FATAL:', e);
  process.exit(1);
});
