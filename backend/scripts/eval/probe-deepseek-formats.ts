/**
 * Диагностический пробник: какие форматы вывода работают на DeepSeek-V4-Pro,
 * с thinking-режимом и без него.
 *
 * Один и тот же микро-запрос ("извлеки 3 факта в JSON"), 8 вариантов
 * комбинаций (response_format × tools × thinking).
 *
 * Запуск: cd backend && bun run scripts/eval/probe-deepseek-formats.ts
 */
import OpenAI from 'openai';

if (!process.env.DEEPSEEK_API_KEY) {
  console.error('✗ DEEPSEEK_API_KEY не задан');
  process.exit(1);
}

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
});

const MODEL = process.env.PROBE_MODEL ?? 'deepseek-v4-pro';

const SYSTEM_BASE =
  'Ты — извлекатель фактов. На вход получаешь предложение, возвращаешь 3 ключевых факта в виде JSON-объекта { "facts": [string, string, string] }.';

const USER_BASE =
  'Предложение: "Иван Петров продаёт CRM-систему компании Альфа за 50 тысяч рублей в месяц с 10-процентной скидкой при оплате за год."';

const JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['facts'],
  properties: {
    facts: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 },
  },
} as const;

const EXTRACT_TOOL = {
  type: 'function' as const,
  function: {
    name: 'submit_facts',
    description: 'Отдать 3 извлечённых факта.',
    parameters: JSON_SCHEMA,
  },
};

interface ProbeResult {
  variant: string;
  ok: boolean;
  ms: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  parsedOk: boolean;
  outputPreview: string;
  error?: string;
}

// DeepSeek-V4-Pro со скидкой 75% (постоянная).
const PRICE_IN = 0.435 / 1_000_000;
const PRICE_OUT = 0.87 / 1_000_000;

async function probe(
  variant: string,
  params: Record<string, unknown>,
): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_BASE },
        { role: 'user', content: USER_BASE },
      ],
      max_tokens: 2000,
      ...params,
    } as Parameters<typeof client.chat.completions.create>[0])) as unknown as {
      choices: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{ function: { arguments: string } }>;
        };
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const ms = Date.now() - start;
    const usage = resp.usage ?? {};
    const tokensIn = usage.prompt_tokens ?? 0;
    const tokensOut = usage.completion_tokens ?? 0;
    const costUsd = tokensIn * PRICE_IN + tokensOut * PRICE_OUT;

    const msg = resp.choices[0]?.message;
    let raw = '';
    if (msg?.tool_calls && msg.tool_calls.length > 0) {
      raw = msg.tool_calls[0]!.function.arguments;
    } else {
      raw = msg?.content ?? '';
    }
    let parsedOk = false;
    try {
      const parsed = JSON.parse(raw) as { facts?: unknown };
      parsedOk = Array.isArray(parsed.facts) && parsed.facts.length === 3;
    } catch {
      parsedOk = false;
    }
    return {
      variant,
      ok: true,
      ms,
      tokensIn,
      tokensOut,
      costUsd,
      parsedOk,
      outputPreview: raw.slice(0, 120).replace(/\s+/g, ' '),
    };
  } catch (e) {
    const ms = Date.now() - start;
    return {
      variant,
      ok: false,
      ms,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      parsedOk: false,
      outputPreview: '',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function main(): Promise<void> {
  console.log(`=== DeepSeek-V4-Pro probe: что работает ===\n`);
  const variants: Array<{ name: string; params: Record<string, unknown> }> = [
    // 1. Без response_format — просто текст
    { name: 'A. plain text (без response_format, без tools)', params: {} },
    // 2. json_object — мягкий режим
    {
      name: 'B. response_format=json_object',
      params: { response_format: { type: 'json_object' } },
    },
    // 3. json_schema strict — известно что падает с thinking
    {
      name: 'C. response_format=json_schema STRICT',
      params: {
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'facts', strict: true, schema: JSON_SCHEMA },
        },
      },
    },
    // 4. json_schema без strict
    {
      name: 'D. response_format=json_schema (strict=false)',
      params: {
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'facts', strict: false, schema: JSON_SCHEMA },
        },
      },
    },
    // 5. tools + tool_choice=auto (модель сама решает)
    {
      name: 'E. tools + tool_choice=auto',
      params: { tools: [EXTRACT_TOOL], tool_choice: 'auto' },
    },
    // 6. tools + tool_choice=required (любой tool)
    {
      name: 'F. tools + tool_choice=required',
      params: { tools: [EXTRACT_TOOL], tool_choice: 'required' },
    },
    // 7. tools + forced конкретный
    {
      name: 'G. tools + tool_choice=forced(submit_facts)',
      params: {
        tools: [EXTRACT_TOOL],
        tool_choice: {
          type: 'function',
          function: { name: 'submit_facts' },
        },
      },
    },
    // 8. plain text + reasoning effort=low (попытка минимизировать thinking)
    {
      name: 'H. reasoning.effort=low + json_object',
      params: {
        response_format: { type: 'json_object' },
        reasoning: { effort: 'low' },
      },
    },
  ];

  const results: ProbeResult[] = [];
  for (const v of variants) {
    process.stdout.write(`  → ${v.name}…`);
    const r = await probe(v.name, v.params);
    const tag = !r.ok
      ? '✗ ОШИБКА'
      : r.parsedOk
        ? '✓ JSON OK'
        : '~ ответ есть, но JSON.parse / shape failed';
    console.log(
      ` ${tag} | ${r.ms} мс | вход=${r.tokensIn} выход=${r.tokensOut}`,
    );
    if (r.error) console.log(`     ошибка: ${r.error}`);
    if (r.ok && r.outputPreview)
      console.log(`     превью: ${r.outputPreview}`);
    results.push(r);
  }

  // ── сводка ────────────────────────────────────────────────────────────────
  console.log('\n=== Сводка ===');
  const wOK = results.filter((r) => r.parsedOk).length;
  const wPartial = results.filter((r) => r.ok && !r.parsedOk).length;
  const wFail = results.filter((r) => !r.ok).length;
  console.log(`  валидный JSON: ${wOK}  | ответ без валидного JSON: ${wPartial}  | API-ошибка: ${wFail}`);
  console.log(`  суммарно ms:   ${results.reduce((s, r) => s + r.ms, 0)}`);
  console.log(
    `  суммарно $:    ${results.reduce((s, r) => s + r.costUsd, 0).toFixed(4)}`,
  );

  console.log('\n— что работает (вернули валидный JSON по схеме):');
  for (const r of results) {
    if (r.parsedOk)
      console.log(
        `  ✓ ${r.variant.padEnd(50)} ${r.ms} мс / ${r.tokensOut} токенов выход`,
      );
  }
  console.log('\n— что упало:');
  for (const r of results) {
    if (!r.ok)
      console.log(
        `  ✗ ${r.variant.padEnd(50)} ${r.error?.slice(0, 80) ?? ''}`,
      );
  }
  console.log('\n— что прошло, но JSON битый/неполный:');
  for (const r of results) {
    if (r.ok && !r.parsedOk)
      console.log(
        `  ~ ${r.variant.padEnd(50)} превью: ${r.outputPreview.slice(0, 60)}`,
      );
  }
}

main().catch((e) => {
  console.error('\n✗ FATAL:', e);
  process.exit(1);
});
