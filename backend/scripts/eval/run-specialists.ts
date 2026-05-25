/**
 * Эксперимент: 5 специалистов knowledge-core (3-1, 3-3, 3-5, 3-6, 3-9) — три варианта.
 *
 *   Variant A: 5 раздельных вызовов, каждый — batch блоков своего типа.
 *   Variant Б: 1 объединённый вызов на все блоки.
 *   Variant В: 2 групповых вызова (Группа 1: decisions+ideas+experiments; Группа 2: regulations+insights).
 *
 * Запуск:
 *   cd backend && bun run scripts/eval/run-specialists.ts a   # Variant A
 *   cd backend && bun run scripts/eval/run-specialists.ts b   # Variant Б
 *   cd backend && bun run scripts/eval/run-specialists.ts c   # Variant В
 */
import { promises as fs } from 'fs';
import path from 'path';
import OpenAI from 'openai';

const MODEL = 'deepseek-v4-pro';
const PRICE_IN = 0.435 / 1_000_000;
const PRICE_CACHED_IN = 0.003625 / 1_000_000;
const PRICE_OUT = 0.87 / 1_000_000;
const MAX_TOKENS_PER_CALL = 32000;

const VARIANT = (process.argv[2] ?? 'a').toLowerCase();
if (!['a', 'b', 'c'].includes(VARIANT)) {
  console.error('Usage: bun run scripts/eval/run-specialists.ts <a|b|c>');
  process.exit(1);
}

// Абсолютные пути от расположения скрипта (не зависят от cwd).
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]):/, '$1:');
const FIXTURE_PATH = path.resolve(
  SCRIPT_DIR,
  '../../test/eval/specialists-experiment/fixtures/meeting-blocks.json',
);
const REPORT_PATH = path.resolve(
  SCRIPT_DIR,
  `../../test/eval/specialists-experiment/reports/variant-${VARIANT}.json`,
);

interface MeetingBlock {
  id: string;
  name: string;
  criticalQuestion: string;
  trustedAnswer: string;
  signalType: string;
  tags: string[];
  evidence: {
    quote: string;
    startMs: number;
    endMs: number;
    speaker: string;
  };
  mentionedPersons: string[];
}

interface Fixture {
  fixtureId: string;
  meetingTitle: string;
  meetingType: string;
  scenario: string;
  blocks: MeetingBlock[];
}

if (!process.env.DEEPSEEK_API_KEY) {
  console.error('✗ DEEPSEEK_API_KEY не задан');
  process.exit(1);
}
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
});

// ── фильтры блоков по signalType ────────────────────────────────────────────
const SIGNAL_FILTERS = {
  decisions: ['decision', 'rationale'],
  ideas: ['idea', 'feature_request'],
  insights: ['pain', 'risk', 'blocker'],
  experiments: ['hypothesis', 'result', 'lesson'],
  regulations: ['regulation', 'process_step'],
};

function filterBlocks(blocks: MeetingBlock[], signalTypes: string[]): MeetingBlock[] {
  const set = new Set(signalTypes);
  return blocks.filter((b) => set.has(b.signalType));
}

function blocksToContext(blocks: MeetingBlock[]): string {
  return blocks
    .map(
      (b) =>
        `[BLOCK:${b.id}] (signalType=${b.signalType}, tags=${b.tags.join(',') || '-'})\n  название: ${b.name}\n  вопрос: ${b.criticalQuestion}\n  ответ: ${b.trustedAnswer}\n  цитата (${b.evidence.speaker}): «${b.evidence.quote}»`,
    )
    .join('\n\n');
}

// ── общий вызов ─────────────────────────────────────────────────────────────
interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_cache_hit_tokens?: number;
  cached_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

interface CallReport {
  step: string;
  ok: boolean;
  ms: number;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  costUsd: number;
  blocksGiven: number;
  entitiesExtracted: number;
  error?: string;
  output?: unknown;
}

async function callOne(opts: {
  step: string;
  system: string;
  user: string;
  toolName: string;
  toolParams: Record<string, unknown>;
  blocksGiven: number;
  entityCountKey?: string;
  entityCountKeys?: string[];
}): Promise<CallReport> {
  console.log(`  → ${opts.step}…`);
  const start = Date.now();
  let usage: Usage = {};
  let output: unknown = undefined;
  let error: string | undefined;
  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: opts.system },
        {
          role: 'user',
          content: opts.user + `\n\nВажно: верни результат через вызов инструмента ${opts.toolName}.`,
        },
      ],
      max_tokens: MAX_TOKENS_PER_CALL,
      tools: [
        {
          type: 'function',
          function: {
            name: opts.toolName,
            description: `Отдать структурированный результат специалиста.`,
            parameters: opts.toolParams,
          },
        },
      ],
      tool_choice: 'auto',
    } as Parameters<typeof client.chat.completions.create>[0])) as unknown as {
      choices: Array<{
        message?: { content?: string | null; tool_calls?: Array<{ function: { arguments: string } }> };
      }>;
      usage?: Usage;
    };
    usage = resp.usage ?? {};
    const call = resp.choices[0]?.message?.tool_calls?.[0];
    if (!call) {
      error = 'модель не позвала tool';
      output = resp.choices[0]?.message?.content ?? '';
    } else {
      try {
        output = JSON.parse(call.function.arguments);
      } catch (e) {
        error = `JSON.parse: ${(e as Error).message}`;
        output = { rawArgs: call.function.arguments, parseError: (e as Error).message };
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
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

  // подсчёт сущностей в выходе
  let entitiesExtracted = 0;
  if (output && typeof output === 'object') {
    if (opts.entityCountKey) {
      const arr = (output as Record<string, unknown>)[opts.entityCountKey];
      if (Array.isArray(arr)) entitiesExtracted = arr.length;
    } else if (opts.entityCountKeys) {
      for (const k of opts.entityCountKeys) {
        const arr = (output as Record<string, unknown>)[k];
        if (Array.isArray(arr)) entitiesExtracted += arr.length;
      }
    }
  }
  console.log(
    `    ${error ? '✗' : '✓'} ${ms} мс | вход=${tokensIn} (кэш=${cachedTokens}) выход=${tokensOut} | $${costUsd.toFixed(4)} | блоков=${opts.blocksGiven} → сущностей=${entitiesExtracted}${error ? ` | ${error}` : ''}`,
  );
  return {
    step: opts.step,
    ok: !error,
    ms,
    tokensIn,
    tokensOut,
    cachedTokens,
    costUsd,
    blocksGiven: opts.blocksGiven,
    entitiesExtracted,
    error,
    output,
  };
}

// ── схемы (упрощённые версии, отражают суть продовых) ──────────────────────
const DECISION_ITEM = {
  type: 'object',
  required: ['sourceBlockId', 'statement', 'confidence'],
  properties: {
    sourceBlockId: { type: 'string' },
    statement: { type: 'string' },
    rationale: { type: ['string', 'null'] },
    alternatives: { type: 'array', items: { type: 'string' } },
    decidedBy: { type: 'array', items: { type: 'string' } },
    status: { type: 'string', enum: ['proposed', 'approved', 'rejected', 'implemented'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};
const IDEA_ITEM = {
  type: 'object',
  required: ['sourceBlockId', 'kind', 'statement', 'confidence'],
  properties: {
    sourceBlockId: { type: 'string' },
    kind: { type: 'string', enum: ['internal', 'client_request'] },
    statement: { type: 'string' },
    rationale: { type: ['string', 'null'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};
const INSIGHT_ITEM = {
  type: 'object',
  required: ['sourceBlockId', 'kind', 'statement', 'severity', 'causeCategory', 'confidence'],
  properties: {
    sourceBlockId: { type: 'string' },
    kind: { type: 'string', enum: ['problem', 'risk', 'blocker', 'inefficiency'] },
    statement: { type: 'string' },
    severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
    causeCategory: {
      type: 'string',
      enum: ['process_gap', 'tooling', 'role_skill', 'communication', 'priority', 'resource_constraint', 'external', 'unknown'],
    },
    mitigationSuggestion: { type: ['string', 'null'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};
const EXPERIMENT_ITEM = {
  type: 'object',
  required: ['sourceBlockId', 'name', 'hypothesisText', 'status', 'confidence'],
  properties: {
    sourceBlockId: { type: 'string' },
    name: { type: 'string' },
    hypothesisText: { type: 'string' },
    currentResult: { type: ['string', 'null'] },
    lessons: {
      type: 'array',
      items: {
        type: 'object',
        required: ['text', 'type'],
        properties: {
          text: { type: 'string' },
          type: { type: 'string', enum: ['what_worked', 'what_failed', 'next_time'] },
        },
      },
    },
    status: { type: 'string', enum: ['hypothesis', 'running', 'completed', 'dropped', 'paused'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};
const REGULATION_ITEM = {
  type: 'object',
  required: ['sourceBlockId', 'kind', 'name', 'statement', 'confidence'],
  properties: {
    sourceBlockId: { type: 'string' },
    kind: { type: 'string', enum: ['regulation', 'process', 'policy', 'standard'] },
    name: { type: 'string' },
    statement: { type: 'string' },
    severity: { type: 'string', enum: ['advisory', 'mandatory', 'blocking'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

// ── system промпты (компактно — суть из прода) ───────────────────────────────
const SYS_DECISIONS =
  'Ты — knowledge-инженер. Тебе дают батч IdeaBlock-ов с signalType ∈ {decision, rationale}. Для каждого блока извлеки структурированное решение. Не выдумывай факты вне блока. statement — суть решения одним предложением. rationale — ПОЧЕМУ так решили. alternatives — какие варианты рассматривали (пустой массив если не упоминалось). status по умолчанию "approved". sourceBlockId — id блока, из которого извлёк решение.';
const SYS_IDEAS =
  'Ты — knowledge-инженер. Тебе дают батч IdeaBlock-ов с signalType ∈ {idea, feature_request}. Для каждого извлеки структурированную идею. kind=client_request если идея пришла от клиента/партнёра, иначе internal. statement — суть идеи. rationale — почему стоит сделать (null если не упомянуто).';
const SYS_INSIGHTS =
  'Ты — knowledge-инженер. Тебе дают батч IdeaBlock-ов с signalType ∈ {pain, risk, blocker}. Для каждого извлеки сигнал проблемы. kind: problem/risk/blocker/inefficiency. severity: low/medium/high/critical (medium по умолчанию, critical только если явная потеря клиента/выручки). causeCategory обязательна (process_gap/tooling/role_skill/communication/priority/resource_constraint/external/unknown). mitigationSuggestion — если в блоке есть идея реагирования, иначе null.';
const SYS_EXPERIMENTS =
  'Ты — knowledge-инженер. Тебе дают батч IdeaBlock-ов с signalType ∈ {hypothesis, result, lesson}. Для каждого извлеки эксперимент. name ≤80 символов. hypothesisText — что проверяли. currentResult — что вышло (null если нет). lessons[] — массив выводов с type (what_worked/what_failed/next_time). status: hypothesis/running/completed/dropped/paused.';
const SYS_REGULATIONS =
  'Ты — knowledge-инженер. Тебе дают батч IdeaBlock-ов с signalType ∈ {regulation, process_step}. Для каждого извлеки регламент/процесс/политику. kind: regulation (формальное правило) / process (последовательность шагов) / policy (правило с severity) / standard (внешний стандарт). statement — суть.';

const SYS_COMBINED = `Ты — knowledge-инженер. Получаешь батч IdeaBlock-ов одной встречи с разными signalType. Для КАЖДОГО блока определяешь, к какой типизированной сущности он относится, и извлекаешь её. Возвращаешь все сущности через инструмент submit_all_entities одним вызовом.

Правила маршрутизации блоков по signalType:
- decision, rationale → decisions[]
- idea, feature_request → ideas[]
- pain, risk, blocker → insights[]
- hypothesis, result, lesson → experiments[]
- regulation, process_step → regulations[]
- остальные (fact, expertise, mentoring, и т.д.) → пропускай.

Для каждой сущности указывай sourceBlockId (id исходного блока). Не выдумывай факты вне блоков. Один блок = одна сущность (для experiments может быть один блок = part of эксперимента, если уже есть эксперимент с тем же name — добавь lesson туда; иначе новый).

decisions: statement (суть), rationale (почему, null если нет), alternatives[], status (approved по умолчанию), confidence.
ideas: kind (internal/client_request), statement, rationale, confidence.
insights: kind (problem/risk/blocker/inefficiency), severity (low/medium/high/critical), causeCategory (process_gap/tooling/role_skill/communication/priority/resource_constraint/external/unknown), mitigationSuggestion, confidence.
experiments: name (≤80), hypothesisText, currentResult, lessons[{text, type:what_worked/what_failed/next_time}], status (hypothesis/running/completed/dropped/paused), confidence.
regulations: kind (regulation/process/policy/standard), name, statement, severity (для policy: advisory/mandatory/blocking), confidence.`;

const SYS_GROUP1 = `Ты — knowledge-инженер. Получаешь батч IdeaBlock-ов с signalType ∈ {decision, rationale, idea, feature_request, hypothesis, result, lesson}.

Для каждого блока извлекаешь типизированную сущность по правилам:
- decision/rationale → decisions[]: statement, rationale, alternatives[], status, confidence.
- idea/feature_request → ideas[]: kind (internal/client_request), statement, rationale, confidence.
- hypothesis/result/lesson → experiments[]: name, hypothesisText, currentResult, lessons[], status, confidence.

sourceBlockId — обязательно. Не выдумывай.`;

const SYS_GROUP2 = `Ты — knowledge-инженер. Получаешь батч IdeaBlock-ов с signalType ∈ {regulation, process_step, pain, risk, blocker}.

Для каждого блока извлекаешь:
- regulation/process_step → regulations[]: kind (regulation/process/policy/standard), name, statement, severity, confidence.
- pain/risk/blocker → insights[]: kind (problem/risk/blocker/inefficiency), severity, causeCategory, mitigationSuggestion, confidence.

sourceBlockId — обязательно. Не выдумывай.`;

// ── варианты ─────────────────────────────────────────────────────────────────
async function runVariantA(fixture: Fixture): Promise<CallReport[]> {
  const tasks = [
    {
      step: '3-3 decisions',
      blocks: filterBlocks(fixture.blocks, SIGNAL_FILTERS.decisions),
      system: SYS_DECISIONS,
      toolName: 'submit_decisions',
      toolParams: {
        type: 'object',
        required: ['decisions'],
        properties: { decisions: { type: 'array', items: DECISION_ITEM } },
      },
      entityCountKey: 'decisions',
    },
    {
      step: '3-6 ideas',
      blocks: filterBlocks(fixture.blocks, SIGNAL_FILTERS.ideas),
      system: SYS_IDEAS,
      toolName: 'submit_ideas',
      toolParams: {
        type: 'object',
        required: ['ideas'],
        properties: { ideas: { type: 'array', items: IDEA_ITEM } },
      },
      entityCountKey: 'ideas',
    },
    {
      step: '3-5 insights',
      blocks: filterBlocks(fixture.blocks, SIGNAL_FILTERS.insights),
      system: SYS_INSIGHTS,
      toolName: 'submit_insights',
      toolParams: {
        type: 'object',
        required: ['insights'],
        properties: { insights: { type: 'array', items: INSIGHT_ITEM } },
      },
      entityCountKey: 'insights',
    },
    {
      step: '3-9 experiments',
      blocks: filterBlocks(fixture.blocks, SIGNAL_FILTERS.experiments),
      system: SYS_EXPERIMENTS,
      toolName: 'submit_experiments',
      toolParams: {
        type: 'object',
        required: ['experiments'],
        properties: { experiments: { type: 'array', items: EXPERIMENT_ITEM } },
      },
      entityCountKey: 'experiments',
    },
    {
      step: '3-1 regulations',
      blocks: filterBlocks(fixture.blocks, SIGNAL_FILTERS.regulations),
      system: SYS_REGULATIONS,
      toolName: 'submit_regulations',
      toolParams: {
        type: 'object',
        required: ['regulations'],
        properties: { regulations: { type: 'array', items: REGULATION_ITEM } },
      },
      entityCountKey: 'regulations',
    },
  ];
  console.log(`\n→ параллельно: 5 специалистов`);
  return Promise.all(
    tasks.map((t) =>
      callOne({
        step: t.step,
        system: t.system,
        user: `Батч блоков для извлечения (${t.blocks.length} шт):\n\n${blocksToContext(t.blocks)}`,
        toolName: t.toolName,
        toolParams: t.toolParams,
        blocksGiven: t.blocks.length,
        entityCountKey: t.entityCountKey,
      }),
    ),
  );
}

async function runVariantB(fixture: Fixture): Promise<CallReport[]> {
  console.log(`\n→ один объединённый вызов`);
  const r = await callOne({
    step: 'combined',
    system: SYS_COMBINED,
    user: `Все блоки встречи (${fixture.blocks.length} шт):\n\n${blocksToContext(fixture.blocks)}`,
    toolName: 'submit_all_entities',
    toolParams: {
      type: 'object',
      required: ['decisions', 'ideas', 'insights', 'experiments', 'regulations'],
      properties: {
        decisions: { type: 'array', items: DECISION_ITEM },
        ideas: { type: 'array', items: IDEA_ITEM },
        insights: { type: 'array', items: INSIGHT_ITEM },
        experiments: { type: 'array', items: EXPERIMENT_ITEM },
        regulations: { type: 'array', items: REGULATION_ITEM },
      },
    },
    blocksGiven: fixture.blocks.length,
    entityCountKeys: ['decisions', 'ideas', 'insights', 'experiments', 'regulations'],
  });
  return [r];
}

async function runVariantC(fixture: Fixture): Promise<CallReport[]> {
  const group1Signals = [
    ...SIGNAL_FILTERS.decisions,
    ...SIGNAL_FILTERS.ideas,
    ...SIGNAL_FILTERS.experiments,
  ];
  const group2Signals = [...SIGNAL_FILTERS.regulations, ...SIGNAL_FILTERS.insights];
  const group1Blocks = filterBlocks(fixture.blocks, group1Signals);
  const group2Blocks = filterBlocks(fixture.blocks, group2Signals);

  console.log(`\n→ параллельно: 2 группы`);
  return Promise.all([
    callOne({
      step: 'group1 (decisions+ideas+experiments)',
      system: SYS_GROUP1,
      user: `Блоки группы 1 (${group1Blocks.length} шт):\n\n${blocksToContext(group1Blocks)}`,
      toolName: 'submit_group1',
      toolParams: {
        type: 'object',
        required: ['decisions', 'ideas', 'experiments'],
        properties: {
          decisions: { type: 'array', items: DECISION_ITEM },
          ideas: { type: 'array', items: IDEA_ITEM },
          experiments: { type: 'array', items: EXPERIMENT_ITEM },
        },
      },
      blocksGiven: group1Blocks.length,
      entityCountKeys: ['decisions', 'ideas', 'experiments'],
    }),
    callOne({
      step: 'group2 (regulations+insights)',
      system: SYS_GROUP2,
      user: `Блоки группы 2 (${group2Blocks.length} шт):\n\n${blocksToContext(group2Blocks)}`,
      toolName: 'submit_group2',
      toolParams: {
        type: 'object',
        required: ['regulations', 'insights'],
        properties: {
          regulations: { type: 'array', items: REGULATION_ITEM },
          insights: { type: 'array', items: INSIGHT_ITEM },
        },
      },
      blocksGiven: group2Blocks.length,
      entityCountKeys: ['regulations', 'insights'],
    }),
  ]);
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log(`=== Variant ${VARIANT.toUpperCase()} — specialists ===`);
  console.log(`  модель: ${MODEL}`);
  console.log(`  фикстура: ${path.basename(FIXTURE_PATH)}\n`);
  const fixture: Fixture = JSON.parse(await fs.readFile(FIXTURE_PATH, 'utf-8'));
  console.log(`  блоков всего: ${fixture.blocks.length}\n`);

  const totalStart = Date.now();
  let reports: CallReport[];
  if (VARIANT === 'a') reports = await runVariantA(fixture);
  else if (VARIANT === 'b') reports = await runVariantB(fixture);
  else reports = await runVariantC(fixture);
  const totalMs = Date.now() - totalStart;

  const tokensIn = reports.reduce((s, r) => s + r.tokensIn, 0);
  const tokensOut = reports.reduce((s, r) => s + r.tokensOut, 0);
  const cached = reports.reduce((s, r) => s + r.cachedTokens, 0);
  const costUsd = reports.reduce((s, r) => s + r.costUsd, 0);
  const entities = reports.reduce((s, r) => s + r.entitiesExtracted, 0);
  const fails = reports.filter((r) => !r.ok).length;

  console.log('\n=== Итоги ===');
  console.log(`  вызовов: ${reports.length}  (упало: ${fails})`);
  console.log(`  итог. время:   ${totalMs} мс`);
  console.log(`  токены: вход=${tokensIn} (кэш=${cached}) выход=${tokensOut}`);
  console.log(`  стоимость:     $${costUsd.toFixed(4)}`);
  console.log(`  сущностей всего: ${entities}`);

  await fs.writeFile(
    REPORT_PATH,
    JSON.stringify(
      {
        variant: VARIANT.toUpperCase(),
        fixtureId: fixture.fixtureId,
        model: MODEL,
        totalMs,
        totalTokensIn: tokensIn,
        totalTokensOut: tokensOut,
        totalCachedTokens: cached,
        totalCostUsd: costUsd,
        totalEntities: entities,
        steps: reports,
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
