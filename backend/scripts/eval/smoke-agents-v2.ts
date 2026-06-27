import OpenAI from 'openai';

import {
  PROBE_RESPONSE_CLASSIFY_SYSTEM_PROMPT,
  PROBE_RESPONSE_CLASSIFY_USER_TEMPLATE,
} from '../../src/modules/probe/prompts/probe-response-classify.prompt';

const PRICE_V4_PRO = {
  in: 1.74 / 1_000_000,
  cachedIn: 0.174 / 1_000_000,
  out: 3.48 / 1_000_000,
};
const PRICE_V4_FLASH = {
  in: 0.14 / 1_000_000,
  cachedIn: 0.014 / 1_000_000,
  out: 0.28 / 1_000_000,
};

if (!process.env.DEEPSEEK_API_KEY) {
  console.error('❌ DEEPSEEK_API_KEY не задан в backend/.env');
  process.exit(1);
}

const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
});

interface CallResult {
  text: string;
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
    cached_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  ms: number;
}

async function call(args: {
  model: 'deepseek-v4-pro' | 'deepseek-v4-flash';
  system: string;
  user: string;
}): Promise<CallResult> {
  const start = Date.now();
  const resp = (await deepseek.chat.completions.create({
    model: args.model,
    messages: [
      { role: 'system', content: args.system },
      { role: 'user', content: args.user },
    ],
    max_tokens: 2000,
    temperature: 0.3,
  } as Parameters<typeof deepseek.chat.completions.create>[0])) as unknown as {
    choices: Array<{ message?: { content?: string | null } }>;
    usage?: CallResult['usage'];
  };
  return {
    text: resp.choices[0]?.message?.content ?? '',
    usage: resp.usage ?? {},
    ms: Date.now() - start,
  };
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced?.[1]?.trim() ?? trimmed;
  return JSON.parse(body);
}

function computeCost(
  usage: CallResult['usage'],
  price: typeof PRICE_V4_PRO,
): {
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  costUsd: number;
} {
  const tokensIn = usage.prompt_tokens ?? 0;
  const tokensOut = usage.completion_tokens ?? 0;
  const cachedTokens =
    usage.prompt_cache_hit_tokens ??
    usage.cached_tokens ??
    usage.prompt_tokens_details?.cached_tokens ??
    0;
  const uncached = Math.max(0, tokensIn - cachedTokens);
  const costUsd = uncached * price.in + cachedTokens * price.cachedIn + tokensOut * price.out;
  return { tokensIn, tokensOut, cachedTokens, costUsd };
}

interface CaseReport {
  name: string;
  model: 'deepseek-v4-pro' | 'deepseek-v4-flash';
  cold: {
    ok: boolean;
    ms: number;
    tokensIn: number;
    tokensOut: number;
    cachedTokens: number;
    costUsd: number;
    parsed?: unknown;
    error?: string;
  };
  warm: {
    ok: boolean;
    ms: number;
    tokensIn: number;
    tokensOut: number;
    cachedTokens: number;
    costUsd: number;
    cacheHitRatio: number;
  };
}

const results: CaseReport[] = [];

async function runCase(args: {
  name: string;
  model: 'deepseek-v4-pro' | 'deepseek-v4-flash';
  system: string;
  user: string;
  validate: (parsed: unknown) => boolean;
}): Promise<void> {
  const price = args.model === 'deepseek-v4-pro' ? PRICE_V4_PRO : PRICE_V4_FLASH;
  const cold = await call({ model: args.model, system: args.system, user: args.user });
  let coldParsed: unknown;
  let coldOk = false;
  let coldError: string | undefined;
  try {
    coldParsed = extractJson(cold.text);
    coldOk = args.validate(coldParsed);
  } catch (e) {
    coldError = e instanceof Error ? e.message : String(e);
  }
  const coldCost = computeCost(cold.usage, price);

  const warm = await call({ model: args.model, system: args.system, user: args.user + ' ' });
  const warmCost = computeCost(warm.usage, price);
  const cacheHitRatio = warmCost.tokensIn > 0 ? warmCost.cachedTokens / warmCost.tokensIn : 0;

  results.push({
    name: args.name,
    model: args.model,
    cold: {
      ok: coldOk,
      ms: cold.ms,
      tokensIn: coldCost.tokensIn,
      tokensOut: coldCost.tokensOut,
      cachedTokens: coldCost.cachedTokens,
      costUsd: coldCost.costUsd,
      parsed: coldParsed,
      error: coldError,
    },
    warm: {
      ok: warm.text.length > 0,
      ms: warm.ms,
      tokensIn: warmCost.tokensIn,
      tokensOut: warmCost.tokensOut,
      cachedTokens: warmCost.cachedTokens,
      costUsd: warmCost.costUsd,
      cacheHitRatio,
    },
  });
}

async function case1ProbeResponseClassify(): Promise<void> {
  await runCase({
    name: 'probe-response-classify',
    model: 'deepseek-v4-flash',
    system: PROBE_RESPONSE_CLASSIFY_SYSTEM_PROMPT,
    user: PROBE_RESPONSE_CLASSIFY_USER_TEMPLATE({
      question: 'Вы согласовали повышение цены с финдиректором?',
      response: 'да я с ним вчера переговорил, он одобрил, можем катить',
    }),
    validate: (p) => {
      const x = p as { reasoning: string; outcome: string; value: string; confidence: number };
      const outcomes = ['apply', 'delete', 'refine', 'counter_question', 'unclear'];
      return (
        typeof x.reasoning === 'string' &&
        outcomes.includes(x.outcome) &&
        typeof x.value === 'string' &&
        typeof x.confidence === 'number' &&
        x.confidence >= 0 &&
        x.confidence <= 1 &&
        x.outcome === 'apply' &&
        x.confidence >= 0.6
      );
    },
  });
}

async function case2MultiAgentDebate(): Promise<void> {
  const scenario = `КОНТЕКСТ: Существующее решение от 2026-04-10: "Использовать PostgreSQL для основной БД, бэкапы через pg_dump каждые 6 часов".

КАНДИДАТ-РЕШЕНИЕ от 2026-05-29: "Перейти на PostgreSQL + Patroni-кластер с continuous WAL-archiving в S3 и pg_dump оставить только для еженедельных холодных снапшотов".

ВОПРОС: Это superseding (заменяет старое), merge (дополняет — pg_dump остаётся), или new (про другое)?`;

  const system =
    'Ты — арбитр. Прочитай контекст и кандидат-решение. Выдай verdict ∈ {supersedes, merge, new} с reasoning ≤200 слов и confidence 0..1. Ответ строго в JSON: {"verdict": "...", "reasoning": "...", "confidence": 0.X}.';

  const start = Date.now();
  const [critic, supporter, neutral] = await Promise.all([
    call({
      model: 'deepseek-v4-pro',
      system:
        system +
        '\n\nТы — критик. Ищи причины НЕ принимать кандидат. Default — отказ при сомнении.',
      user: scenario,
    }),
    call({
      model: 'deepseek-v4-pro',
      system: system + '\n\nТы ищешь причины ПРИНЯТЬ кандидат. Default — принятие при сигналах.',
      user: scenario,
    }),
    call({
      model: 'deepseek-v4-flash',
      system: system + '\n\nТы нейтральный арбитр. Взвесь pro и contra.',
      user: scenario,
    }),
  ]);
  const totalMs = Date.now() - start;

  const votes: Array<{ stance: string; verdict: string; confidence: number; reasoning: string }> =
    [];
  for (const [stance, res] of [
    ['critic', critic],
    ['supporter', supporter],
    ['neutral', neutral],
  ] as const) {
    try {
      const p = extractJson(res.text) as { verdict: string; reasoning: string; confidence: number };
      votes.push({
        stance,
        verdict: p.verdict,
        confidence: p.confidence,
        reasoning: p.reasoning.slice(0, 120),
      });
    } catch (e) {
      votes.push({
        stance,
        verdict: 'PARSE_ERROR',
        confidence: 0,
        reasoning: String(e).slice(0, 120),
      });
    }
  }
  const counts = new Map<string, number>();
  for (const v of votes) counts.set(v.verdict, (counts.get(v.verdict) ?? 0) + 1);
  const max = Math.max(...counts.values());
  const winners = [...counts.entries()].filter(([, c]) => c === max);
  const consensusType = winners.length === 1 ? (max === 3 ? 'unanimous' : 'majority') : 'split';
  const decision = winners[0]?.[0] ?? 'split_uncertain';

  const ok = votes.length === 3 && consensusType !== 'split' && decision !== 'PARSE_ERROR';

  const totalCost =
    computeCost(critic.usage, PRICE_V4_PRO).costUsd +
    computeCost(supporter.usage, PRICE_V4_PRO).costUsd +
    computeCost(neutral.usage, PRICE_V4_FLASH).costUsd;
  results.push({
    name: 'multi-agent-debate',
    model: 'deepseek-v4-pro',
    cold: {
      ok,
      ms: totalMs,
      tokensIn:
        (critic.usage.prompt_tokens ?? 0) +
        (supporter.usage.prompt_tokens ?? 0) +
        (neutral.usage.prompt_tokens ?? 0),
      tokensOut:
        (critic.usage.completion_tokens ?? 0) +
        (supporter.usage.completion_tokens ?? 0) +
        (neutral.usage.completion_tokens ?? 0),
      cachedTokens: 0,
      costUsd: totalCost,
      parsed: { decision, consensusType, votes },
    },
    warm: {
      ok: true,
      ms: 0,
      tokensIn: 0,
      tokensOut: 0,
      cachedTokens: 0,
      costUsd: 0,
      cacheHitRatio: 0,
    },
  });
}

async function case3AutoruleExtract(): Promise<void> {
  await runCase({
    name: 'autorule-extract',
    model: 'deepseek-v4-pro',
    system:
      'Ты анализируешь пары (original, edited) AI-output. Найди консистентное правило, отличающее edited от original. Игнорируй опечатки/перестановки слов. Сосредоточься на: что добавили, что убрали, какой структуры стало больше. Верни строго JSON: {"rule": "≤200 chars", "ruleType": "must_do"|"must_not_do"|"tone"|"structure", "confidence": 0..1, "examples": [{"originalSnippet": "", "editedSnippet": "", "why": ""}], "reasoning": "≤300 chars"}.',
    user: `Пары для анализа:

ПАРА 1:
  original: "Решение: внедрить новый CRM. Бюджет: 5М. Сроки: Q3."
  edited:   "Решение: внедрить новый CRM (Salesforce, согласовано с CTO).\\nБюджет: 5М ₽ (одобрен Юрием 2026-04-15).\\nСроки: Q3 2026 (kickoff 2026-07-01)."

ПАРА 2:
  original: "Перенести релиз на неделю."
  edited:   "Перенести релиз на неделю (с 2026-06-01 на 2026-06-08, согласовано в #releases)."

ПАРА 3:
  original: "Нанять senior frontend разработчика."
  edited:   "Нанять senior frontend разработчика (React+TS, full-time, до 2026-07-30, утверждено CEO 2026-05-29)."`,
    validate: (p) => {
      const x = p as { rule: string; ruleType: string; confidence: number; examples: unknown[] };
      return (
        typeof x.rule === 'string' &&
        x.rule.length > 10 &&
        ['must_do', 'must_not_do', 'tone', 'structure'].includes(x.ruleType) &&
        x.confidence >= 0.5 &&
        Array.isArray(x.examples)
      );
    },
  });
}

async function case4ConciergeStepPrm(): Promise<void> {
  await runCase({
    name: 'concierge-step-prm',
    model: 'deepseek-v4-flash',
    system:
      'Ты оцениваешь, насколько инструмент-кандидат приблизит к цели пользователя. Ответ строго JSON: {"score": 0..1, "reasoning": "≤500 chars"}.',
    user: `ЦЕЛЬ ПОЛЬЗОВАТЕЛЯ: "Создай встречу с Алексеем на завтра 15:00 на 30 минут, тема — обсуждение Q3 roadmap"

ИСТОРИЯ: пустая (первое сообщение).

КАНДИДАТ-ИНСТРУМЕНТ:
  name: createMeeting
  args: { participant: "Алексей", date: "2026-05-31T15:00:00+03:00", duration: 30, topic: "Q3 roadmap" }

КОНТЕКСТ: пользователь — Юрий, в компании 5 Алексеев.

Оцени score 0..1 (насколько хорошо инструмент решает цель).`,
    validate: (p) => {
      const x = p as { score: number; reasoning: string };
      return (
        typeof x.score === 'number' &&
        x.score >= 0 &&
        x.score <= 1 &&
        typeof x.reasoning === 'string' &&
        x.reasoning.length > 10
      );
    },
  });
}

async function case5PracticeSkillExtract(): Promise<void> {
  await runCase({
    name: 'practice-skill-extract',
    model: 'deepseek-v4-pro',
    system:
      'На основе reasoning-блоков сотрудника извлеки выполняемую процедуру — рецепт "когда X → делай 1, 2, 3". Только если в блоках видны конкретные шаги. Ответ строго JSON: {"skill": {"trigger": "≤200 chars", "steps": [{"order": 1, "action": "...", "emotionalRegister": "..."}], "redFlags": ["..."], "reasoning": "..."} | null, "confidence": 0..1}. Если нет конкретных шагов — skill: null.',
    user: `REASONING-БЛОКИ сотрудника-маркетолога (роль "Маркетолог"):

[1] "Когда клиент возражает на цену enterprise-плана, я сначала не оправдываюсь и не предлагаю скидку сразу. Я задаю один вопрос: 'А с чем именно вы сравниваете нашу цену?' Это переводит разговор в плоскость value, а не price."

[2] "После того как клиент назвал альтернативу, я не критикую её, а спрашиваю: 'Что вам в той опции нравится, а что не очень?' Это даёт мне 2 вещи: их value-фреймворк и список их болей."

[3] "Только потом я перечисляю 2-3 наших фичи которые покрывают именно их боли. Не больше — иначе разговор уходит в фичелистинг. После — пауза, жду реакции, не дожимаю."

[4] "Если клиент молчит больше 5 секунд — я сам говорю 'я понимаю, нужно подумать, давайте я пришлю короткое сравнение и созвонимся через 2 дня'. Никогда не дожимать в первом звонке."

ЗАДАЧА: извлеки practice-skill (рецепт).`,
    validate: (p) => {
      const x = p as { skill: { trigger: string; steps: unknown[] } | null; confidence: number };
      return (
        x.skill !== null &&
        typeof x.skill.trigger === 'string' &&
        x.skill.trigger.length > 10 &&
        Array.isArray(x.skill.steps) &&
        x.skill.steps.length >= 2 &&
        x.confidence >= 0.5
      );
    },
  });
}

async function main(): Promise<void> {
  console.log('=== smoke-agents-v2: real DeepSeek calls (v4-pro + v4-flash) ===\n');

  for (const [i, fn] of [
    case1ProbeResponseClassify,
    case2MultiAgentDebate,
    case3AutoruleExtract,
    case4ConciergeStepPrm,
    case5PracticeSkillExtract,
  ].entries()) {
    process.stdout.write(`${i + 1}/5 ${fn.name}... `);
    try {
      await fn();
      console.log('done');
    } catch (e) {
      console.log('FATAL: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  console.log('\n=== РЕЗУЛЬТАТЫ ===\n');
  for (const r of results) {
    const status = r.cold.ok ? '✅' : '❌';
    const cacheTag =
      r.warm.cachedTokens > 0 ? ` cache_hit=${(r.warm.cacheHitRatio * 100).toFixed(0)}%` : '';
    console.log(
      `${status} ${r.name} [${r.model}] cold=${r.cold.ms}ms warm=${r.warm.ms}ms${cacheTag}`,
    );
    console.log(
      `   cold: in=${r.cold.tokensIn} out=${r.cold.tokensOut} cached=${r.cold.cachedTokens} cost=$${r.cold.costUsd.toFixed(5)}`,
    );
    console.log(
      `   warm: in=${r.warm.tokensIn} out=${r.warm.tokensOut} cached=${r.warm.cachedTokens} cost=$${r.warm.costUsd.toFixed(5)}`,
    );
    if (r.cold.error) {
      console.log(`   ERROR: ${r.cold.error}`);
    } else if (r.cold.parsed) {
      console.log(
        `   PARSED: ${JSON.stringify(r.cold.parsed).slice(0, 350)}${JSON.stringify(r.cold.parsed).length > 350 ? '...' : ''}`,
      );
    }
    console.log('');
  }

  const okCount = results.filter((r) => r.cold.ok).length;
  const totalCost = results.reduce((sum, r) => sum + r.cold.costUsd + r.warm.costUsd, 0);
  console.log(
    `=== ИТОГ: ${okCount}/${results.length} green | total cost: $${totalCost.toFixed(4)} ===`,
  );
  process.exit(okCount === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
