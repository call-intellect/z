/**
 * Variant Б — один объединённый вызов на сыром транскрипте.
 *
 *   fixture → один вызов DeepSeek-V4-Pro с большим tool, возвращающим
 *             { chapters, tasks, summary_markdown, quality_score }
 *
 * Отличие от Variant A:
 *   - Нет block-ingest шага. Модель работает прямо на тексте транскрипта.
 *   - Один вызов вместо 5. Все 4 секции в одной JSON-схеме.
 *
 * Запуск: cd backend && bun run scripts/eval/run-variant-b-single.ts
 */
import { promises as fs } from 'fs';
import path from 'path';
import OpenAI from 'openai';

// ── константы ────────────────────────────────────────────────────────────────
const MODEL = 'deepseek-v4-pro';
// DeepSeek-V4-Pro со скидкой 75% (постоянная):
//   input miss $0.435/M, cache hit $0.003625/M, output $0.87/M.
const PRICE_IN = 0.435 / 1_000_000;
const PRICE_CACHED_IN = 0.003625 / 1_000_000;
const PRICE_OUT = 0.87 / 1_000_000;
// Объединённый вывод (главы + задачи + резюме + оценка) — большой output + thinking.
const MAX_TOKENS_COMBINED = 32000;

const FIXTURE_ID = process.argv[2] ?? 'fixture-01-pilot';
const FIXTURE_PATH = path.resolve(
  `test/eval/sales-merge-experiment/fixtures/${FIXTURE_ID}.json`,
);
const REPORT_PATH = path.resolve(
  `test/eval/sales-merge-experiment/reports/${FIXTURE_ID}-variant-b.json`,
);

// ── типы фикстуры ────────────────────────────────────────────────────────────
interface FixtureJson {
  fixtureId: string;
  meetingType: 'sales';
  scenario: string;
  meta: {
    clientName: string;
    vendorName: string;
    speakers: Array<{ name: string; role: string; side: string }>;
    expectedFacts: string[];
  };
  transcript: string;
}

// ── клиент ───────────────────────────────────────────────────────────────────
if (!process.env.DEEPSEEK_API_KEY) {
  console.error('✗ DEEPSEEK_API_KEY не задан');
  process.exit(1);
}
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
});

// ── объединённый tool (4 секции в одном выходе) ──────────────────────────────
const COMBINED_TOOL = {
  type: 'function' as const,
  function: {
    name: 'submit_meeting_analysis',
    description:
      'Отдать полный анализ встречи: главы, задачи, резюме, оценка качества.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['chapters', 'tasks', 'summary_markdown', 'quality_score'],
      properties: {
        chapters: {
          type: 'array',
          description:
            'Главы встречи (5-12 шт). Каждая глава = смысловой сегмент, по которому удобно прыгать в плеере. Главы идут подряд, не пересекаются.',
          items: {
            type: 'object',
            required: ['title', 'summary', 'startMs', 'endMs'],
            properties: {
              title: {
                type: 'string',
                description:
                  'Короткое название главы (≤200 символов), без префикса "Глава N:".',
              },
              summary: {
                type: 'string',
                description: '1-3 предложения по существу о чём эта глава.',
              },
              startMs: {
                type: 'integer',
                minimum: 0,
                description: 'Начало главы в миллисекундах от старта встречи.',
              },
              endMs: {
                type: 'integer',
                minimum: 0,
                description: 'Конец главы в миллисекундах.',
              },
            },
          },
        },
        tasks: {
          type: 'array',
          description:
            'Явные поручения / action items. Только то, что прозвучало явно (не пожелания, не идеи). Если нет — пустой массив.',
          items: {
            type: 'object',
            required: ['title', 'confidence'],
            properties: {
              title: {
                type: 'string',
                description: 'Глагол + объект ("Подготовить договор").',
              },
              assigneeRaw: {
                type: ['string', 'null'],
                description:
                  'Имя или роль исполнителя как прозвучало ("Иван", "Маркетинг"). null если не названо.',
              },
              dueDateIso: {
                type: ['string', 'null'],
                description:
                  'YYYY-MM-DD если прозвучала конкретная дата. null если относительно ("на следующей неделе") или не названо.',
              },
              sourceQuote: {
                type: 'string',
                description:
                  'Дословная цитата (или близкая склейка) из транскрипта, обосновывающая задачу.',
              },
              confidence: {
                type: 'number',
                minimum: 0,
                maximum: 1,
                description: 'Уверенность, что это РЕАЛЬНАЯ задача (0..1).',
              },
            },
          },
        },
        summary_markdown: {
          type: 'string',
          description:
            'Итоговая сводка встречи в формате markdown. Для типа sales: стадия сделки, боли клиента, возражения, договорённости, следующие шаги.',
        },
        quality_score: {
          type: 'object',
          required: ['overallScore', 'categories', 'recommendations', 'strengths'],
          properties: {
            overallScore: {
              type: 'integer',
              minimum: 0,
              maximum: 100,
              description: 'Общий балл качества (взвешенное среднее категорий).',
            },
            categories: {
              type: 'object',
              required: [
                'preparation',
                'structure',
                'clarity',
                'outcomes',
                'engagement',
              ],
              properties: {
                preparation: { type: 'integer', minimum: 0, maximum: 100 },
                structure: { type: 'integer', minimum: 0, maximum: 100 },
                clarity: { type: 'integer', minimum: 0, maximum: 100 },
                outcomes: { type: 'integer', minimum: 0, maximum: 100 },
                engagement: { type: 'integer', minimum: 0, maximum: 100 },
              },
            },
            recommendations: {
              type: 'array',
              minItems: 1,
              maxItems: 10,
              items: {
                type: 'object',
                required: ['text', 'severity', 'category'],
                properties: {
                  text: { type: 'string' },
                  severity: {
                    type: 'string',
                    enum: ['info', 'warning', 'critical'],
                  },
                  category: {
                    type: 'string',
                    enum: [
                      'preparation',
                      'structure',
                      'clarity',
                      'outcomes',
                      'engagement',
                    ],
                  },
                },
              },
            },
            strengths: {
              type: 'array',
              maxItems: 8,
              items: { type: 'string' },
            },
          },
        },
      },
    },
  },
};

// ── системный промпт (объединённый) ──────────────────────────────────────────
const SYSTEM_PROMPT = `Ты — аналитик деловых видеовстреч. Получаешь транскрипт продажной встречи и возвращаешь полный комплексный анализ через инструмент submit_meeting_analysis.

Анализ состоит из 4 секций. Все 4 — обязательны.

═══ Секция 1: chapters (главы встречи) ═══

Разбей встречу на 5-12 смысловых глав. Глава = группа подряд идущих обсуждений по одной теме.
- title: короткое название (≤200 символов), без "Глава N:".
- summary: 1-3 предложения по существу.
- startMs / endMs: таймкоды в миллисекундах. Считай от первой реплики транскрипта = 0.
  Используй временные метки [mm:ss] из транскрипта.
- Главы идут подряд, не пересекаются.

═══ Секция 2: tasks (явные поручения) ═══

Найди EXPLICIT задачи: кто что должен сделать.
- Не выдумывай. Если поручений нет — пустой массив.
- НЕ выдавай вежливые формулировки ("может быть стоит…", "было бы здорово…") — это не задачи.
- title: глагол + объект ("Подготовить договор").
- assigneeRaw: имя/роль как прозвучало. null если не названо.
- dueDateIso: YYYY-MM-DD только если конкретная дата. null для "на следующей неделе".
- sourceQuote: дословная цитата из транскрипта.
- confidence: 0..1 — насколько уверен, что это РЕАЛЬНАЯ задача, а не пожелание.

═══ Секция 3: summary_markdown (итоговая сводка) ═══

Markdown-текст для продажной встречи. Структура:
- На какой стадии сделка / разговор.
- Какие боли клиента озвучены.
- Какие возражения сняты или открыты.
- Какие договорённости достигнуты.
- Следующие шаги.

По существу, без воды. Только то, что есть в транскрипте — не дополняй контекстом.

═══ Секция 4: quality_score (оценка качества встречи) ═══

Оцени встречу по 5 категориям (0..100):
- preparation — была ли озвучена повестка, цель встречи в первые 5 минут?
- structure — есть ли структура (введение → обсуждение → итоги)?
- clarity — конкретны ли формулировки решений?
- outcomes — есть ли конкретные решения с ответственными и сроками?
- engagement — активны ли все участники?

overallScore — взвешенное среднее.

recommendations: 3-7 действий "как сделать встречу лучше". severity:
- info — наблюдение, можно лучше, но не критично.
- warning — заметная проблема: исправление существенно улучшит будущие встречи.
- critical — серьёзный провал (overall ≤ 40 или явный антипаттерн).

strengths: 2-4 пункта что было хорошо.

═══ Тон и язык ═══

- Все строки на русском.
- Рекомендации — ДЕЙСТВИЯ ("Озвучить повестку в первые 5 минут"), а НЕ диагнозы.
- Не выдумывай данных, которых нет в транскрипте.

ВАЖНО: верни результат строго через вызов инструмента submit_meeting_analysis. Не пиши ничего вне tool_use.`;

// ── вызов ────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('=== Variant Б — один объединённый вызов на сыром транскрипте ===');
  console.log(`  модель:    ${MODEL}`);
  console.log(`  фикстура:  ${path.basename(FIXTURE_PATH)}`);
  const fixtureRaw = await fs.readFile(FIXTURE_PATH, 'utf-8');
  const fixture: FixtureJson = JSON.parse(fixtureRaw);
  console.log(
    `  знаков:    ${fixture.transcript.length}, тип: ${fixture.meetingType}\n`,
  );

  const userMessage = `Заголовок встречи: ${fixture.meta.vendorName} ↔ ${fixture.meta.clientName} (${fixture.meetingType})

Транскрипт:
${fixture.transcript}

Верни полный анализ через инструмент submit_meeting_analysis.`;

  console.log('  → запрос…');
  const start = Date.now();
  let usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
    cached_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  } = {};
  let output: unknown = undefined;
  let jsonValid = true;
  let error: string | undefined;

  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      max_tokens: MAX_TOKENS_COMBINED,
      tools: [COMBINED_TOOL],
      tool_choice: 'auto',
    } as Parameters<typeof client.chat.completions.create>[0])) as unknown as {
      choices: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{ function: { name: string; arguments: string } }>;
        };
      }>;
      usage?: typeof usage;
    };
    usage = resp.usage ?? {};
    const msg = resp.choices[0]?.message;
    const call = msg?.tool_calls?.[0];
    if (!call) {
      jsonValid = false;
      error = 'модель не позвала tool (свободный текст вместо структурного)';
      output = msg?.content ?? '';
    } else {
      try {
        output = JSON.parse(call.function.arguments);
      } catch (e) {
        jsonValid = false;
        error = `JSON.parse tool args: ${(e as Error).message}`;
        output = call.function.arguments;
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    jsonValid = false;
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
    `\n  ${error ? '✗' : '✓'} ${ms} мс | вход=${tokensIn} (кэш=${cachedTokens}) выход=${tokensOut} | $${costUsd.toFixed(4)}${error ? ` | ${error}` : ''}`,
  );

  // ── сводка секций ───────────────────────────────────────────────────────────
  if (jsonValid && typeof output === 'object' && output !== null) {
    const out = output as {
      chapters?: unknown[];
      tasks?: unknown[];
      summary_markdown?: string;
      quality_score?: { overallScore?: number };
    };
    console.log('\n=== Секции вывода ===');
    console.log(`  chapters:        ${out.chapters?.length ?? 0}`);
    console.log(`  tasks:           ${out.tasks?.length ?? 0}`);
    console.log(`  summary_markdown: ${out.summary_markdown?.length ?? 0} знаков`);
    console.log(`  overallScore:    ${out.quality_score?.overallScore ?? '—'}`);
  }

  // ── отчёт ───────────────────────────────────────────────────────────────────
  await fs.writeFile(
    REPORT_PATH,
    JSON.stringify(
      {
        variant: 'B',
        fixtureId: fixture.fixtureId,
        model: MODEL,
        totalMs: ms,
        totalTokensIn: tokensIn,
        totalTokensOut: tokensOut,
        totalCachedTokens: cachedTokens,
        totalCostUsd: costUsd,
        jsonValid,
        error,
        output,
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
