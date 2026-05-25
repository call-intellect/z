/**
 * Variant Б для диалоговой цепочки — один объединённый вызов.
 *
 *   fixture → один tool-вызов, возвращающий:
 *     { intent, standalone_question, multi_queries, confidence, answer_mode, answer_markdown }
 *
 * Запуск: cd backend && bun run scripts/eval/run-dialog-variant-b.ts <fixture-id>
 */
import { promises as fs } from 'fs';
import path from 'path';
import OpenAI from 'openai';

const MODEL = 'deepseek-v4-pro';
// DeepSeek-V4-Pro со скидкой 75%.
const PRICE_IN = 0.435 / 1_000_000;
const PRICE_CACHED_IN = 0.003625 / 1_000_000;
const PRICE_OUT = 0.87 / 1_000_000;
const MAX_TOKENS_COMBINED = 16000;

const FIXTURE_ID = process.argv[2] ?? 'dialog-01-factual';
const FIXTURE_PATH = path.resolve(
  `test/eval/dialog-experiment/fixtures/${FIXTURE_ID}.json`,
);
const REPORT_PATH = path.resolve(
  `test/eval/dialog-experiment/reports/${FIXTURE_ID}-variant-b.json`,
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
  intent_expected: string;
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

// ── объединённый tool ───────────────────────────────────────────────────────
const COMBINED_TOOL = {
  type: 'function' as const,
  function: {
    name: 'submit_dialog_response',
    description:
      'Полный анализ диалогового запроса: intent, standalone-вопрос, переформулировки, оценка уверенности, ответ.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: [
        'intent',
        'standalone_question',
        'multi_queries',
        'confidence',
        'answer_mode',
        'answer_markdown',
      ],
      properties: {
        intent: {
          type: 'string',
          enum: ['factual', 'exploratory', 'analytical', 'clone_roleplay'],
          description:
            'Намерение: factual — конкретный факт; exploratory — обзор; analytical — анализ/тренд; clone_roleplay — спросить от лица сотрудника.',
        },
        standalone_question: {
          type: 'string',
          description:
            'Полная переформулировка вопроса без зависимости от истории диалога. Местоимения заменены на конкретные имена из истории. Если оригинал уже standalone — повтори его.',
        },
        multi_queries: {
          type: 'array',
          items: { type: 'string' },
          description:
            '3 переформулировки для расширения поиска: (1) синонимы, (2) другая перспектива, (3) более узкая. Только для exploratory/analytical. Для factual/clone_roleplay — пустой массив.',
        },
        confidence: {
          type: 'object',
          required: ['value', 'reason'],
          properties: {
            value: {
              type: 'number',
              minimum: 0,
              maximum: 1,
              description:
                'Насколько standalone_question сохранил смысл оригинала: 1.0 — полностью, 0.7 — мелкие искажения, 0.3 — смысл искажён.',
            },
            reason: { type: 'string' },
          },
        },
        answer_mode: {
          type: 'string',
          enum: ['factual', 'synthetic'],
          description:
            'factual — 1-3 предложения, только прямые цитаты блоков; synthetic — 3-15 предложений, обобщение с маркировкой уверенности.',
        },
        answer_markdown: {
          type: 'string',
          description:
            'Финальный ответ на русском в markdown. Все ключевые утверждения помечены [BLOCK:<id>]. В synthetic — маркировка уверенности («по нескольким источникам», «однажды упоминалось»); противоречия — [BLOCK:id1] vs [BLOCK:id2]. В factual — только прямые цитаты. НЕ выдумывай blockId, которых нет в контексте.',
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `Ты — комплексный диалоговый помощник AI-чата компании. На вход получаешь:
- историю диалога (может быть пустой);
- сжатый контекст диалога (может быть пустым);
- текущий вопрос пользователя;
- найденные блоки памяти компании.

Возвращаешь полный анализ через инструмент submit_dialog_response. Все 6 полей обязательны.

═══ 1. intent ═══
- factual         — нужен конкретный факт/цифра.
- exploratory     — нужен обзор темы.
- analytical      — нужен вывод/сравнение/причина.
- clone_roleplay  — пользователь хочет «спросить у конкретного сотрудника» (имя в вопросе).

═══ 2. standalone_question ═══
Восстанови вопрос так, чтобы он был понятен без истории. Местоимения и «тот/этот/там/он» — замени на конкретные имена из истории. Если вопрос уже standalone — повтори его.

═══ 3. multi_queries ═══
Для exploratory/analytical — 3 переформулировки:
1) синонимическая (другие термины, тот же смысл);
2) с другой перспективы;
3) более узкая (одна подцель оригинала).
Для factual/clone_roleplay — пустой массив.

═══ 4. confidence ═══
Оцени качество твоего standalone_question. 1.0 — смысл полностью сохранён; 0.7 — мелкие искажения; 0.3 — смысл искажён. reason — 1-2 предложения почему.

═══ 5. answer_mode ═══
- factual — для intent=factual: коротко, 1-3 предложения, только прямые цитаты блоков.
- synthetic — для intent=exploratory/analytical: 3-15 предложений, с обобщением.

═══ 6. answer_markdown ═══
Финальный ответ на русском.

Правила ответа (важно):
- Опирайся ТОЛЬКО на блоки из «Контекст». Никаких внешних знаний.
- Каждое ключевое утверждение помечай маркером [BLOCK:<id>].
- НЕ выдумывай blockId, которых нет в контексте.
- В synthetic явно маркируй уверенность:
  - «по нескольким источникам» — если факт в 2+ блоках;
  - «однажды упоминалось» — единичный источник;
  - «возможно устарело» — если блок старый или конфликт.
- Если блоки противоречат — упомяни оба: [BLOCK:id1] vs [BLOCK:id2].
- Если ответа в блоках прямо нет — честно скажи «Не нашёл прямого ответа в памяти компании».

Верни результат через инструмент submit_dialog_response.`;

function buildBlocksContext(blocks: MockBlock[]): string {
  return blocks
    .map(
      (b) =>
        `[BLOCK:${b.id}] (signalType=${b.signalType}, tags=${b.tags.join(',')})\nВопрос: ${b.criticalQuestion}\nОтвет: ${b.trustedAnswer}\nЦитата из встречи "${b.evidence[0]?.sourceMeetingTitle}" (${b.evidence[0]?.speaker}): «${b.evidence[0]?.quote}»`,
    )
    .join('\n\n');
}

function buildHistoryBlock(
  history: DialogFixture['history'],
  summary: string | null,
): string {
  const parts: string[] = [];
  if (summary && summary.length > 0) {
    parts.push('Контекст диалога (сжато):', summary, '');
  }
  if (history.length > 0) {
    parts.push('История диалога (последние сообщения):');
    for (const m of history) {
      const role = m.role === 'user' ? 'Пользователь' : 'Ассистент';
      parts.push(`- ${role}: ${m.content}`);
    }
  } else {
    parts.push('История диалога: пуста (первое сообщение).');
  }
  return parts.join('\n');
}

async function main(): Promise<void> {
  console.log('=== Variant Б — один объединённый вызов диалоговой цепочки ===');
  console.log(`  модель:    ${MODEL}`);
  console.log(`  фикстура:  ${path.basename(FIXTURE_PATH)}`);
  const fixture: DialogFixture = JSON.parse(
    await fs.readFile(FIXTURE_PATH, 'utf-8'),
  );
  console.log(
    `  сценарий:  ${fixture.scenario}\n  блоков:    ${fixture.mock_blocks.length}\n`,
  );

  const userMessage = `${buildHistoryBlock(fixture.history, fixture.conversation_summary)}

Текущий вопрос пользователя: ${fixture.user_question}

Найденные блоки памяти:

${buildBlocksContext(fixture.mock_blocks)}

Верни полный анализ через инструмент submit_dialog_response.`;

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
          tool_calls?: Array<{ function: { arguments: string } }>;
        };
      }>;
      usage?: typeof usage;
    };
    usage = resp.usage ?? {};
    const call = resp.choices[0]?.message?.tool_calls?.[0];
    if (!call) {
      jsonValid = false;
      error = 'модель не позвала tool';
      output = resp.choices[0]?.message?.content ?? '';
    } else {
      try {
        output = JSON.parse(call.function.arguments);
      } catch (e) {
        jsonValid = false;
        error = `JSON.parse: ${(e as Error).message}`;
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

  if (jsonValid && typeof output === 'object' && output !== null) {
    const out = output as {
      intent?: string;
      standalone_question?: string;
      multi_queries?: unknown[];
      confidence?: { value?: number };
      answer_mode?: string;
      answer_markdown?: string;
    };
    console.log('\n=== Секции вывода ===');
    console.log(`  intent:               ${out.intent}`);
    console.log(`  standalone_question:  ${out.standalone_question?.slice(0, 100)}...`);
    console.log(`  multi_queries:        ${out.multi_queries?.length ?? 0} шт`);
    console.log(`  confidence.value:     ${out.confidence?.value}`);
    console.log(`  answer_mode:          ${out.answer_mode}`);
    console.log(`  answer_markdown:      ${out.answer_markdown?.length ?? 0} знаков`);
  }

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
