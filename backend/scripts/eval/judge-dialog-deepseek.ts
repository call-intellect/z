import { promises as fs } from 'fs';
import path from 'path';
import OpenAI from 'openai';

const MODEL = 'deepseek-v4-pro';
const PRICE_IN = 0.435 / 1_000_000;
const PRICE_OUT = 0.87 / 1_000_000;

const FIXTURE_ID = process.argv[2] ?? 'dialog-01-factual';
const FIXTURE_PATH = path.resolve(`test/eval/dialog-experiment/fixtures/${FIXTURE_ID}.json`);
const A_PATH = path.resolve(`test/eval/dialog-experiment/reports/${FIXTURE_ID}-variant-a.json`);
const B_PATH = path.resolve(`test/eval/dialog-experiment/reports/${FIXTURE_ID}-variant-b.json`);
const SUMMARY_PATH = path.resolve(`test/eval/dialog-experiment/reports/${FIXTURE_ID}-SUMMARY.md`);

if (!process.env.DEEPSEEK_API_KEY) {
  console.error('✗ DEEPSEEK_API_KEY не задан');
  process.exit(1);
}
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
});

interface Normalized {
  intent: string;
  standalone_question: string;
  multi_queries: string[];
  confidence: { value: number; reason: string };
  answer_mode: string;
  answer_markdown: string;
}

function findStep(steps: Array<{ step: string; output?: unknown }>, key: string): unknown {
  return steps.find((s) => s.step.includes(key))?.output;
}

function normalizeA(aReport: {
  steps: Array<{ step: string; output?: unknown }>;
  derived?: { standalone?: string; intent?: string };
}): Normalized {
  const ctxOut = findStep(aReport.steps, 'contextualize');
  const classifyOut = findStep(aReport.steps, 'classify') as { intent?: string };
  const multiOut = findStep(aReport.steps, 'multi-query') as { queries?: string[] };
  const confOut = findStep(aReport.steps, 'confidence') as
    | { confidence?: number; reason?: string }
    | undefined;
  const answerStep = aReport.steps.find((s) => s.step.includes('answer'));
  const answerOut = typeof answerStep?.output === 'string' ? answerStep.output : '';
  const answerMode = answerStep?.step.includes('factual') ? 'factual' : 'synthetic';

  return {
    intent: classifyOut?.intent ?? aReport.derived?.intent ?? 'unknown',
    standalone_question: typeof ctxOut === 'string' ? ctxOut : (aReport.derived?.standalone ?? ''),
    multi_queries: multiOut?.queries ?? [],
    confidence: {
      value: confOut?.confidence ?? 0,
      reason: confOut?.reason ?? '',
    },
    answer_mode: answerMode,
    answer_markdown: answerOut,
  };
}

function normalizeB(bReport: { output: unknown }): Normalized {
  const out = bReport.output as Partial<Normalized> & {
    confidence?: { value?: number; reason?: string };
  };
  return {
    intent: out.intent ?? 'unknown',
    standalone_question: out.standalone_question ?? '',
    multi_queries: out.multi_queries ?? [],
    confidence: {
      value: out.confidence?.value ?? 0,
      reason: out.confidence?.reason ?? '',
    },
    answer_mode: out.answer_mode ?? 'synthetic',
    answer_markdown: out.answer_markdown ?? '',
  };
}

const JUDGE_SYSTEM = `Ты — независимый эксперт по диалоговым AI-ассистентам. Тебе дают:
1. Фикстуру диалогового запроса: история, вопрос, найденные блоки памяти, ожидаемые факты.
2. Два разных AI-ответа на этот запрос: вариант X и вариант Y.

Имена X/Y случайны — ты не знаешь, какая система их сгенерировала.

Оцени каждый вариант по 5 критериям шкалой 1-5 (5 = отлично, 1 = плохо):

1. **intent_accuracy** — правильно ли определён тип запроса (factual / exploratory / analytical / clone_roleplay). Сравни с intent_expected из фикстуры.

2. **contextualize_quality** — насколько точно standalone_question восстановил оригинальный вопрос. Если в оригинале есть «он/там/этот проект» — заменены ли они на конкретные имена из истории? Сохранился ли смысл?

3. **multi_query_relevance** — полезны ли 3 переформулировки для поиска (если intent требует). Должны быть разные углы, не повтор оригинала. Для factual/clone_roleplay массив должен быть пуст.

4. **answer_correctness** — главное:
   - покрывает ли ответ expected_facts из фикстуры;
   - нет ли галлюцинаций (фактов, которых нет в блоках);
   - есть ли маркеры [BLOCK:<id>] на ключевых утверждениях;
   - в synthetic-режиме — есть ли маркировка уверенности и упоминание противоречий, если они есть в блоках.

5. **confidence_adequacy** — адекватна ли оценка confidence (value 0..1):
   - если standalone_question действительно сохранил смысл — confidence должен быть высокий (≥0.8);
   - если есть искажения — confidence должен быть ниже;
   - reason должен соответствовать value.

Будь строгим: 5 ставь только если действительно отлично без замечаний.

Верни результат через инструмент submit_judgement.`;

const JUDGE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'submit_judgement',
    description: 'Отдать сравнительную оценку двух вариантов диалогового ответа.',
    parameters: {
      type: 'object',
      required: [
        'intent',
        'contextualize',
        'multi_query',
        'answer',
        'confidence',
        'winner_overall',
        'reasoning',
      ],
      additionalProperties: false,
      properties: {
        intent: {
          type: 'object',
          required: ['score_x', 'score_y', 'explain'],
          properties: {
            score_x: { type: 'integer', minimum: 1, maximum: 5 },
            score_y: { type: 'integer', minimum: 1, maximum: 5 },
            explain: { type: 'string' },
          },
        },
        contextualize: {
          type: 'object',
          required: ['score_x', 'score_y', 'explain'],
          properties: {
            score_x: { type: 'integer', minimum: 1, maximum: 5 },
            score_y: { type: 'integer', minimum: 1, maximum: 5 },
            explain: { type: 'string' },
          },
        },
        multi_query: {
          type: 'object',
          required: ['score_x', 'score_y', 'explain'],
          properties: {
            score_x: { type: 'integer', minimum: 1, maximum: 5 },
            score_y: { type: 'integer', minimum: 1, maximum: 5 },
            explain: { type: 'string' },
          },
        },
        answer: {
          type: 'object',
          required: ['score_x', 'score_y', 'explain'],
          properties: {
            score_x: { type: 'integer', minimum: 1, maximum: 5 },
            score_y: { type: 'integer', minimum: 1, maximum: 5 },
            explain: { type: 'string' },
          },
        },
        confidence: {
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

async function main(): Promise<void> {
  console.log(`=== Судья (DeepSeek-V4-Pro): ${FIXTURE_ID} ===\n`);

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
  console.log(`  Маскировка: X = вариант ${xLabel}, Y = вариант ${yLabel}\n`);

  const userMessage = `# Фикстура диалога

Сценарий: ${fixture.scenario}
Ожидаемый intent: ${fixture.intent_expected}

История диалога: ${
    fixture.history.length === 0
      ? '(пуста — первое сообщение)'
      : '\n' +
        fixture.history
          .map(
            (m: { role: string; content: string }) =>
              `- ${m.role === 'user' ? 'Пользователь' : 'Ассистент'}: ${m.content}`,
          )
          .join('\n')
  }

Текущий вопрос пользователя: ${fixture.user_question}

Ожидаемый standalone-вопрос: ${fixture.standalone_expected}

Ожидаемые факты в ответе:
${(fixture.expected_facts as string[]).map((f, i) => `${i + 1}. ${f}`).join('\n')}

Блоки памяти (mock — все, что бы могли быть найдены поиском):
\`\`\`json
${JSON.stringify(fixture.mock_blocks, null, 2)}
\`\`\`

# Вариант X

\`\`\`json
${JSON.stringify(xOutput, null, 2)}
\`\`\`

# Вариант Y

\`\`\`json
${JSON.stringify(yOutput, null, 2)}
\`\`\`

Оцени оба варианта по 5 критериям. Верни через инструмент submit_judgement.`;

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
      judgement = JSON.parse(call.function.arguments);
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

  const j = judgement as {
    intent: { score_x: number; score_y: number; explain: string };
    contextualize: { score_x: number; score_y: number; explain: string };
    multi_query: { score_x: number; score_y: number; explain: string };
    answer: { score_x: number; score_y: number; explain: string };
    confidence: { score_x: number; score_y: number; explain: string };
    winner_overall: 'X' | 'Y' | 'tie';
    reasoning: string;
  };

  const scoreFor = (label: 'A' | 'B', crit: { score_x: number; score_y: number }): number =>
    label === xLabel ? crit.score_x : crit.score_y;
  const explainNormalized = (text: string): string =>
    text
      .replace(/\bВариант X\b/g, `Вариант ${xLabel}`)
      .replace(/\bВариант Y\b/g, `Вариант ${yLabel}`)
      .replace(/\bX\s*:\s*/g, `${xLabel}: `)
      .replace(/\bY\s*:\s*/g, `${yLabel}: `);
  const winnerReal =
    j.winner_overall === 'tie' ? 'tie' : j.winner_overall === 'X' ? xLabel : yLabel;

  const sumA =
    scoreFor('A', j.intent) +
    scoreFor('A', j.contextualize) +
    scoreFor('A', j.multi_query) +
    scoreFor('A', j.answer) +
    scoreFor('A', j.confidence);
  const sumB =
    scoreFor('B', j.intent) +
    scoreFor('B', j.contextualize) +
    scoreFor('B', j.multi_query) +
    scoreFor('B', j.answer) +
    scoreFor('B', j.confidence);

  const md = `# Сравнение Variant A vs Б — ${FIXTURE_ID}

Дата: ${new Date().toISOString()}
Модели: Variant A/Б — deepseek-v4-pro · Судья — ${MODEL}
Сценарий: ${fixture.scenario}

## Цифровые метрики

| Метрика | Variant A (раздельные шаги) | Variant Б (1 объединённый) | Б |
|---|---|---|---|
| Время | ${(aReport.totalMs / 1000).toFixed(1)} с | ${(bReport.totalMs / 1000).toFixed(1)} с | в ${(aReport.totalMs / bReport.totalMs).toFixed(1)}× быстрее |
| Стоимость | $${aReport.totalCostUsd.toFixed(4)} | $${bReport.totalCostUsd.toFixed(4)} | в ${(aReport.totalCostUsd / bReport.totalCostUsd).toFixed(1)}× дешевле |
| Кол-во вызовов | ${aReport.steps.length} | 1 | — |

## Сводка выходов

| Поле | Variant A | Variant Б |
|---|---|---|
| intent | ${aNorm.intent} | ${bNorm.intent} |
| standalone_question | ${aNorm.standalone_question.length} знаков | ${bNorm.standalone_question.length} знаков |
| multi_queries | ${aNorm.multi_queries.length} шт | ${bNorm.multi_queries.length} шт |
| confidence.value | ${aNorm.confidence.value} | ${bNorm.confidence.value} |
| answer_mode | ${aNorm.answer_mode} | ${bNorm.answer_mode} |
| answer_markdown | ${aNorm.answer_markdown.length} знаков | ${bNorm.answer_markdown.length} знаков |

## Вердикт судьи (${MODEL}, метки скрыты)

**Победитель: ${winnerReal === 'tie' ? 'ничья' : `Variant ${winnerReal}`}**

> ${explainNormalized(j.reasoning)}

### По критериям (5 = отлично, 1 = плохо)

| Критерий | Variant A | Variant Б | Объяснение |
|---|---|---|---|
| intent | ${scoreFor('A', j.intent)} | ${scoreFor('B', j.intent)} | ${explainNormalized(j.intent.explain)} |
| contextualize | ${scoreFor('A', j.contextualize)} | ${scoreFor('B', j.contextualize)} | ${explainNormalized(j.contextualize.explain)} |
| multi_query | ${scoreFor('A', j.multi_query)} | ${scoreFor('B', j.multi_query)} | ${explainNormalized(j.multi_query.explain)} |
| answer | ${scoreFor('A', j.answer)} | ${scoreFor('B', j.answer)} | ${explainNormalized(j.answer.explain)} |
| confidence | ${scoreFor('A', j.confidence)} | ${scoreFor('B', j.confidence)} | ${explainNormalized(j.confidence.explain)} |

### Сумма баллов
- Variant A: ${sumA} / 25
- Variant Б: ${sumB} / 25

## Метаданные эксперимента

- Маскировка: X = вариант ${xLabel}, Y = вариант ${yLabel}.
- Судья: ${MODEL}, вход=${tokensIn} токенов, выход=${tokensOut} токенов, стоимость $${costUsd.toFixed(4)}, время ${(ms / 1000).toFixed(1)} с.
`;

  await fs.writeFile(SUMMARY_PATH, md, 'utf-8');
  console.log(`=== Итог ===`);
  console.log(`  Победитель: ${winnerReal === 'tie' ? 'ничья' : `Variant ${winnerReal}`}`);
  console.log(`  A=${sumA} / Б=${sumB} (из 25)`);
  console.log(`  Резоны: ${explainNormalized(j.reasoning)}`);
  console.log(`\n✓ отчёт: ${SUMMARY_PATH}`);
}

main().catch((e) => {
  console.error('\n✗ FATAL:', e);
  process.exit(1);
});
