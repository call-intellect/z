import OpenAI from 'openai';

import {
  scoreDecisions,
  scoreExtraction,
  type ExtractionScore,
  type GoldenTask,
} from './agent-scoring';

export interface EvalResult {
  score: number;
  pass: boolean;
  perCriterion: Record<string, number | boolean | string>;
  explain: string;
  costUsd: number;
}

export interface RubricExpectation {
  kind: 'tasks' | 'decisions';
  golden: GoldenTask[] | string[];
  minCompleteness?: number;
  minPrecision?: number;
  maxDupeRate?: number;
}

export function scoreRubric(extracted: string[], exp: RubricExpectation): EvalResult {
  const s: ExtractionScore =
    exp.kind === 'tasks'
      ? scoreExtraction(exp.golden as GoldenTask[], extracted)
      : scoreDecisions(exp.golden as string[], extracted);
  const minC = exp.minCompleteness ?? 1;
  const minP = exp.minPrecision ?? 0;
  const maxD = exp.maxDupeRate ?? 0;
  const pass = s.completeness >= minC && s.precision >= minP && s.dupeRate <= maxD;
  const score = (s.completeness + s.precision + (1 - s.dupeRate)) / 3;
  return {
    score,
    pass,
    perCriterion: {
      completeness: s.completeness,
      precision: s.precision,
      dupeRate: s.dupeRate,
      matched: s.matched,
    },
    explain:
      `matched=${s.matched}; missing=[${s.missing.join(' | ')}]; spurious=[${s.spurious.join(' | ')}]`,
    costUsd: 0,
  };
}

export interface InvariantSpec {
  forbiddenWords?: string[];
  requiredKeys?: string[];
  mustBeEmptyExtraction?: { arrayKey: string };
  jsonValid?: boolean;
}

function tryParse(output: string): Record<string, unknown> | null {
  try {
    return JSON.parse(output) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function checkInvariants(output: string, spec: InvariantSpec): EvalResult {
  const failures: string[] = [];
  const lower = output.toLowerCase();
  for (const w of spec.forbiddenWords ?? []) {
    if (lower.includes(w.toLowerCase())) failures.push(`запрещённое слово "${w}"`);
  }
  const obj = tryParse(output);
  if (spec.jsonValid && !obj) failures.push('вывод не валидный JSON');
  if (spec.requiredKeys && obj) {
    for (const k of spec.requiredKeys) {
      if (!(k in obj)) failures.push(`нет обязательного ключа "${k}"`);
    }
  }
  if (spec.mustBeEmptyExtraction && obj) {
    const arr = obj[spec.mustBeEmptyExtraction.arrayKey];
    if (Array.isArray(arr) && arr.length > 0) {
      failures.push(`ожидался отказ (пустой ${spec.mustBeEmptyExtraction.arrayKey}), получено ${arr.length}`);
    }
  }
  const pass = failures.length === 0;
  return {
    score: pass ? 1 : 0,
    pass,
    perCriterion: { invariantsPassed: pass },
    explain: pass ? 'все инварианты выдержаны' : failures.join('; '),
    costUsd: 0,
  };
}

export interface JudgeCriterion {
  key: string;
  question: string;
}

const JUDGE_PRICE = { in: 0.435 / 1_000_000, cachedIn: 0.003625 / 1_000_000, out: 0.87 / 1_000_000 };

function buildJudgeClient(): OpenAI {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY не задан (нужен для LLM-judge).');
  return new OpenAI({
    apiKey,
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
  });
}

export async function scoreByJudge(opts: {
  task: string;
  input: string;
  output: string;
  criteria: JudgeCriterion[];
  passThreshold?: number;
  model?: string;
  client?: OpenAI;
}): Promise<EvalResult> {
  const client = opts.client ?? buildJudgeClient();
  const model = opts.model ?? 'deepseek-v4-pro';
  const threshold = opts.passThreshold ?? 4;

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      scores: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            key: { type: 'string' },
            score: { type: 'integer', minimum: 1, maximum: 5 },
            rationale: { type: 'string' },
          },
          required: ['key', 'score', 'rationale'],
        },
      },
    },
    required: ['scores'],
  };

  const system =
    'Ты строгий, беспристрастный судья качества вывода AI-агента. ' +
    'Оцениваешь КАЖДЫЙ критерий по шкале 1-5 (1 — совсем плохо, 5 — образцово). ' +
    'Будь скептичен: высокий балл только при явном соответствии. ' +
    'Верни результат строго через инструмент submit_judgement.';

  const criteriaList = opts.criteria.map((c) => `- ${c.key}: ${c.question}`).join('\n');
  const user =
    `ЗАДАЧА АГЕНТА: ${opts.task}\n\n` +
    `ВХОД (что подавалось агенту):\n${opts.input}\n\n` +
    `ВЫХОД АГЕНТА (что оцениваем):\n${opts.output}\n\n` +
    `КРИТЕРИИ ОЦЕНКИ:\n${criteriaList}\n\n` +
    'Оцени каждый критерий 1-5 с кратким обоснованием. Верни через submit_judgement.';

  const tool = {
    type: 'function' as const,
    function: {
      name: 'submit_judgement',
      description: 'Отдать оценки по критериям.',
      parameters: schema,
    },
  };

  const resp = (await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: 2000,
    tools: [tool],
    tool_choice: 'auto',
  } as Parameters<typeof client.chat.completions.create>[0])) as unknown as {
    choices: Array<{
      message?: { content?: string | null; tool_calls?: Array<{ function: { arguments: string } }> };
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_cache_hit_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    };
  };

  const raw =
    resp.choices[0]?.message?.tool_calls?.[0]?.function.arguments ??
    resp.choices[0]?.message?.content ??
    '';
  const parsed = tryParse(raw) as { scores?: Array<{ key: string; score: number; rationale: string }> } | null;
  const scores = parsed?.scores ?? [];

  const tokensIn = resp.usage?.prompt_tokens ?? 0;
  const tokensOut = resp.usage?.completion_tokens ?? 0;
  const cached =
    resp.usage?.prompt_cache_hit_tokens ?? resp.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const uncached = Math.max(0, tokensIn - cached);
  const costUsd = uncached * JUDGE_PRICE.in + cached * JUDGE_PRICE.cachedIn + tokensOut * JUDGE_PRICE.out;

  if (scores.length === 0) {
    return {
      score: 0,
      pass: false,
      perCriterion: { judgeError: true },
      explain: `судья не вернул оценок: ${raw.slice(0, 200)}`,
      costUsd,
    };
  }

  const avg = scores.reduce((s, x) => s + x.score, 0) / scores.length;
  const perCriterion: Record<string, number | string> = {};
  for (const s of scores) {
    perCriterion[s.key] = s.score;
    perCriterion[`${s.key}__why`] = s.rationale;
  }
  return {
    score: avg / 5,
    pass: avg >= threshold,
    perCriterion,
    explain: `avg=${avg.toFixed(2)}/5 (порог ${threshold}); ` + scores.map((s) => `${s.key}=${s.score}`).join(' '),
    costUsd,
  };
}
