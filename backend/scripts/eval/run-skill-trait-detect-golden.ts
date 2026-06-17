import { promises as fs } from 'fs';
import path from 'path';
import OpenAI from 'openai';
import 'dotenv/config';

import {
  SKILL_TRAIT_DETECT_JSON_SCHEMA,
  SKILL_TRAIT_DETECT_SCHEMA_NAME,
  SKILL_TRAIT_DETECT_SYSTEM_PROMPT,
  SKILL_TRAIT_DETECT_USER_TEMPLATE,
} from '../../src/modules/knowledge-core/prompts/skill-trait-detect.prompt';

const MODEL = process.env.SKILL_TRAIT_DETECT_GOLDEN_MODEL ?? 'deepseek-v4-pro';
const IS_OPENAI = MODEL.startsWith('gpt-');

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]):/, '$1:');
const FIXTURES_DIR = path.resolve(SCRIPT_DIR, '../../test/eval/skill-trait-detect-golden/fixtures');
const REPORTS_DIR = path.resolve(SCRIPT_DIR, '../../test/eval/skill-trait-detect-golden/reports');

interface FixtureQuote {
  blockId: string;
  quote: string;
  observedAt: string;
}
interface FixtureExpected {
  shouldExtract: boolean;
  reason?: string;
  categoryGloss?: string;
  categoryKeywords?: string[];
  statementContainsQualifier?: boolean;
  minObservations?: number;
  expectedConfidence?: 'low' | 'medium' | 'high';
  forbiddenWords?: string[];
}
interface FixtureData {
  fixtureId: string;
  category: 'valid' | 'reject';
  personName: string;
  personRole?: string | null;
  quotes: FixtureQuote[];
  expected: FixtureExpected;
}

interface LlmResponse {
  category: string;
  statement: string;
  confidence: 'low' | 'medium' | 'high';
  sourceBlockIds: string[];
}

function checkInvariants(
  fixture: FixtureData,
  resp: LlmResponse,
): { pass: boolean; failures: string[] } {
  const failures: string[] = [];
  const exp = fixture.expected;

  if (Array.isArray(exp.forbiddenWords)) {
    const combined = (resp.category + ' ' + resp.statement).toLowerCase();
    for (const word of exp.forbiddenWords) {
      if (combined.includes(word.toLowerCase())) {
        failures.push(`Forbidden word "${word}" present`);
      }
    }
  }
  if (exp.shouldExtract === false) {
    if (resp.sourceBlockIds.length > 0) {
      failures.push('Expected refusal (empty sourceBlockIds), got extraction');
    }
    return { pass: failures.length === 0, failures };
  }
  if (Array.isArray(exp.categoryKeywords)) {
    const combined = (resp.category + ' ' + resp.statement).toLowerCase();
    const matched = exp.categoryKeywords.some((kw) => combined.includes(kw.toLowerCase()));
    if (!matched) {
      failures.push(
        `No categoryKeyword matched. Expected one of [${exp.categoryKeywords.join(', ')}] in: "${resp.category}" / "${resp.statement}"`,
      );
    }
  }
  if (exp.statementContainsQualifier === true) {
    const qualifiers = [
      'похож',
      'склон',
      'в большинстве случаев',
      'часто',
      'как правило',
      'обычно',
    ];
    const has = qualifiers.some((q) => resp.statement.toLowerCase().includes(q));
    if (!has) failures.push(`No qualifier in statement: "${resp.statement}"`);
  }
  if (exp.expectedConfidence && exp.expectedConfidence !== resp.confidence) {
    failures.push(
      `Confidence mismatch: expected ${exp.expectedConfidence}, got ${resp.confidence}`,
    );
  }
  const inputIds = new Set(fixture.quotes.map((q) => q.blockId));
  for (const id of resp.sourceBlockIds) {
    if (!inputIds.has(id)) failures.push(`sourceBlockId "${id}" not in fixture quotes`);
  }
  if (resp.category.length < 3 || resp.category.length > 200) {
    failures.push(`category length out of [3,200]: ${resp.category.length}`);
  }
  if (resp.statement.length < 10 || resp.statement.length > 2000) {
    failures.push(`statement length out of [10,2000]: ${resp.statement.length}`);
  }
  return { pass: failures.length === 0, failures };
}

let client: OpenAI;
let priceIn = 0;
let priceCachedIn = 0;
let priceOut = 0;

if (IS_OPENAI) {
  const baseUrl = process.env.PROXY_BASE_URL ?? 'https://proxy.agent-lia.ru/v1';
  const prefix = process.env.PROXY_PREFIX ?? 'myFeedproxy3128';
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('✗ OPENAI_API_KEY не задан (нужен для gpt-* моделей)');
    process.exit(1);
  }
  client = new OpenAI({ apiKey: `${prefix}:${apiKey}`, baseURL: baseUrl });
  priceIn = 2 / 1_000_000;
  priceCachedIn = 0.2 / 1_000_000;
  priceOut = 10 / 1_000_000;
} else {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.error('✗ DEEPSEEK_API_KEY не задан');
    process.exit(1);
  }
  client = new OpenAI({
    apiKey,
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
  });
  priceIn = 0.435 / 1_000_000;
  priceCachedIn = 0.003625 / 1_000_000;
  priceOut = 0.87 / 1_000_000;
}

async function callLlm(fixture: FixtureData): Promise<{
  response: LlmResponse | null;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  ms: number;
  error?: string;
}> {
  const userPrompt = SKILL_TRAIT_DETECT_USER_TEMPLATE({
    personName: fixture.personName,
    personRole: fixture.personRole ?? null,
    quotes: fixture.quotes,
  });
  const start = Date.now();

  try {
    if (IS_OPENAI) {
      const resp = (await (
        client as unknown as {
          responses: {
            create: (p: Record<string, unknown>) => Promise<{
              output_text?: string;
              usage?: {
                input_tokens?: number;
                output_tokens?: number;
                input_tokens_details?: { cached_tokens?: number };
              };
            }>;
          };
        }
      ).responses.create({
        model: MODEL,
        stream: false,
        instructions: SKILL_TRAIT_DETECT_SYSTEM_PROMPT,
        input: [{ role: 'user', content: userPrompt }],
        max_output_tokens: 4000,
        reasoning: { effort: 'medium' },
        text: {
          format: {
            type: 'json_schema',
            name: SKILL_TRAIT_DETECT_SCHEMA_NAME,
            strict: true,
            schema: SKILL_TRAIT_DETECT_JSON_SCHEMA,
          },
        },
      })) as {
        output_text?: string;
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          input_tokens_details?: { cached_tokens?: number };
        };
      };
      const ms = Date.now() - start;
      const parsed = parseLlmJson(resp.output_text ?? '');
      return {
        response: parsed,
        tokensIn: resp.usage?.input_tokens ?? 0,
        tokensOut: resp.usage?.output_tokens ?? 0,
        cachedTokens: resp.usage?.input_tokens_details?.cached_tokens ?? 0,
        ms,
        error: parsed ? undefined : `Невалидный JSON: ${(resp.output_text ?? '').slice(0, 150)}`,
      };
    } else {
      const tool = {
        type: 'function' as const,
        function: {
          name: 'submit_skill_trait',
          description: 'Отдать извлечённый SkillTrait.',
          parameters: SKILL_TRAIT_DETECT_JSON_SCHEMA,
        },
      };
      const resp = (await client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: 'system', content: SKILL_TRAIT_DETECT_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `${userPrompt}\n\nВерни результат через инструмент submit_skill_trait.`,
          },
        ],
        max_tokens: 4000,
        tools: [tool],
        tool_choice: 'auto',
      } as Parameters<typeof client.chat.completions.create>[0])) as unknown as {
        choices: Array<{
          message?: {
            tool_calls?: Array<{ function: { arguments: string } }>;
            content?: string | null;
          };
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          prompt_cache_hit_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
        };
      };
      const ms = Date.now() - start;
      const call = resp.choices[0]?.message?.tool_calls?.[0];
      let parsed: LlmResponse | null = null;
      let error: string | undefined;
      if (!call) {
        error = 'модель не позвала tool';
      } else {
        parsed = parseLlmJson(call.function.arguments);
        if (!parsed)
          error = `Невалидный JSON в tool args: ${call.function.arguments.slice(0, 150)}`;
      }
      const cached =
        resp.usage?.prompt_cache_hit_tokens ??
        resp.usage?.prompt_tokens_details?.cached_tokens ??
        0;
      return {
        response: parsed,
        tokensIn: resp.usage?.prompt_tokens ?? 0,
        tokensOut: resp.usage?.completion_tokens ?? 0,
        cachedTokens: cached,
        ms,
        error,
      };
    }
  } catch (e) {
    return {
      response: null,
      tokensIn: 0,
      tokensOut: 0,
      cachedTokens: 0,
      ms: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function parseLlmJson(text: string): LlmResponse | null {
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    if (
      typeof obj.category === 'string' &&
      typeof obj.statement === 'string' &&
      (obj.confidence === 'low' || obj.confidence === 'medium' || obj.confidence === 'high') &&
      Array.isArray(obj.sourceBlockIds)
    ) {
      return {
        category: obj.category,
        statement: obj.statement,
        confidence: obj.confidence,
        sourceBlockIds: obj.sourceBlockIds as string[],
      };
    }
    return null;
  } catch {
    return null;
  }
}

interface RunResult {
  fixtureName: string;
  fixtureId: string;
  category: 'valid' | 'reject';
  pass: boolean;
  failures: string[];
  response: LlmResponse | null;
  error?: string;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  ms: number;
  costUsd: number;
}

async function main(): Promise<void> {
  console.log(`=== Golden-прогон skill-trait-detect ===`);
  console.log(
    `  модель: ${MODEL} (${IS_OPENAI ? 'OpenAI Responses через прокси' : 'DeepSeek chat.completions'})`,
  );

  const files = (await fs.readdir(FIXTURES_DIR)).filter((f) => f.endsWith('.json')).sort();
  console.log(`  фикстур: ${files.length}\n`);

  const results: RunResult[] = [];
  let i = 0;
  for (const file of files) {
    i += 1;
    const data: FixtureData = JSON.parse(await fs.readFile(path.join(FIXTURES_DIR, file), 'utf-8'));
    const call = await callLlm(data);
    const uncached = Math.max(0, call.tokensIn - call.cachedTokens);
    const cost = uncached * priceIn + call.cachedTokens * priceCachedIn + call.tokensOut * priceOut;

    let pass = false;
    let failures: string[] = [];
    if (call.error || !call.response) {
      failures = [call.error ?? 'no response'];
    } else {
      const inv = checkInvariants(data, call.response);
      pass = inv.pass;
      failures = inv.failures;
    }

    results.push({
      fixtureName: file,
      fixtureId: data.fixtureId,
      category: data.category,
      pass,
      failures,
      response: call.response,
      error: call.error,
      tokensIn: call.tokensIn,
      tokensOut: call.tokensOut,
      cachedTokens: call.cachedTokens,
      ms: call.ms,
      costUsd: cost,
    });

    const cachePct = call.tokensIn > 0 ? Math.round((call.cachedTokens / call.tokensIn) * 100) : 0;
    console.log(
      `  ${i.toString().padStart(2, ' ')}/${files.length} ${file} ${data.category === 'reject' ? '[REJ]' : '[VAL]'} | ${pass ? '✓' : '✗'} | вход=${call.tokensIn} кэш=${call.cachedTokens} (${cachePct}%) выход=${call.tokensOut} | $${cost.toFixed(5)} | ${call.ms}мс${pass ? '' : ` | ${failures.join('; ')}`}`,
    );
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  const validResults = results.filter((r) => r.category === 'valid');
  const rejectResults = results.filter((r) => r.category === 'reject');
  const validPassed = validResults.filter((r) => r.pass).length;
  const rejectPassed = rejectResults.filter((r) => r.pass).length;
  const totalCost = results.reduce((s, r) => s + r.costUsd, 0);
  const totalIn = results.reduce((s, r) => s + r.tokensIn, 0);
  const totalCached = results.reduce((s, r) => s + r.cachedTokens, 0);
  const totalOut = results.reduce((s, r) => s + r.tokensOut, 0);
  const totalMs = results.reduce((s, r) => s + r.ms, 0);
  const cacheHitRatio = totalIn > 0 ? totalCached / totalIn : 0;

  console.log(`\n========== Итоги (${MODEL}) ==========`);
  console.log(`  Всего фикстур: ${results.length}`);
  console.log(`  Прошли: ${passed} (${Math.round((passed / results.length) * 100)}%)`);
  console.log(`    valid:  ${validPassed}/${validResults.length}`);
  console.log(`    reject: ${rejectPassed}/${rejectResults.length}`);
  console.log(`  Упали:  ${failed}`);
  console.log(
    `  Токены: вход=${totalIn} (кэш=${totalCached}, ${(cacheHitRatio * 100).toFixed(0)}%) выход=${totalOut}`,
  );
  console.log(`  Стоимость суммарно: $${totalCost.toFixed(4)}`);
  console.log(`  Общее время: ${(totalMs / 1000).toFixed(1)} с`);

  const failuresByReason = new Map<string, number>();
  for (const r of results.filter((x) => !x.pass)) {
    for (const f of r.failures) {
      const key = f.split(':')[0]!;
      failuresByReason.set(key, (failuresByReason.get(key) ?? 0) + 1);
    }
  }
  if (failuresByReason.size > 0) {
    console.log('  Причины падений:');
    for (const [reason, n] of [...failuresByReason.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    - ${reason}: ${n}`);
    }
  }

  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const reportPath = path.join(REPORTS_DIR, `golden-${MODEL.replace(/[^a-z0-9.-]/gi, '_')}.json`);
  await fs.writeFile(
    reportPath,
    JSON.stringify(
      {
        model: MODEL,
        timestamp: new Date().toISOString(),
        total: results.length,
        passed,
        failed,
        passRate: passed / results.length,
        validPassRate: validPassed / validResults.length,
        rejectPassRate: rejectPassed / rejectResults.length,
        totalTokensIn: totalIn,
        totalCachedTokens: totalCached,
        cacheHitRatio,
        totalTokensOut: totalOut,
        totalCostUsd: totalCost,
        totalMs,
        failuresByReason: Object.fromEntries(failuresByReason),
        results,
      },
      null,
      2,
    ),
    'utf-8',
  );
  console.log(`\n✓ отчёт: ${reportPath}\n`);
}

main().catch((e) => {
  console.error('\n✗ FATAL:', e);
  process.exit(1);
});
