/**
 * Variant Г — 8 специалистов с ОБЩИМ КЭШИРУЕМЫМ ПРЕФИКСОМ.
 *
 * Главное отличие от A:
 *   - У всех 8 вызовов ОДИН И ТОТ ЖЕ system prompt (роль + все блоки встречи).
 *   - Разный только user (специфика задачи + tool name).
 *   - DeepSeek кэширует общую часть → 2-й и далее вызовы стоят в 100+ раз меньше.
 *
 * Усиление промптов (по сравнению с A):
 *   - Жёсткое требование заполнять rationale, alternatives, mitigationSuggestion.
 *   - Подсказка: «соседние блоки видны в общем контексте — используй их для глубины».
 *
 * 8 специалистов (без 3-4 карточника — он multi-meeting):
 *   3-1 regulations, 3-2 knowledge-clone, 3-3 decisions, 3-5 insights,
 *   3-6 ideas, 3-7 skill-trait, 3-8 helpfulness, 3-9 experiments.
 *
 * Запуск: cd backend && bun run scripts/eval/run-specialists-g.ts
 */
import { promises as fs } from 'fs';
import path from 'path';
import OpenAI from 'openai';

const MODEL = 'deepseek-v4-pro';
const PRICE_IN = 0.435 / 1_000_000;
const PRICE_CACHED_IN = 0.003625 / 1_000_000;
const PRICE_OUT = 0.87 / 1_000_000;
const MAX_TOKENS = 16000;

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]):/, '$1:');
const FIXTURE_PATH = path.resolve(SCRIPT_DIR, '../../test/eval/specialists-experiment/fixtures/meeting-blocks.json');
const REPORT_PATH = path.resolve(SCRIPT_DIR, '../../test/eval/specialists-experiment/reports/variant-g.json');

interface MeetingBlock {
  id: string;
  name: string;
  criticalQuestion: string;
  trustedAnswer: string;
  signalType: string;
  tags: string[];
  evidence: { quote: string; startMs: number; endMs: number; speaker: string };
  mentionedPersons: string[];
}

interface Fixture {
  fixtureId: string;
  meetingTitle: string;
  meetingType: string;
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

// ── общий кэшируемый префикс ────────────────────────────────────────────────
function buildCachePrefix(blocks: MeetingBlock[], meetingTitle: string): string {
  const blocksContext = blocks
    .map(
      (b) =>
        `[BLOCK:${b.id}] (signalType=${b.signalType}, tags=${b.tags.join(',') || '-'}, persons=${b.mentionedPersons.join(',') || '-'})\n  название: ${b.name}\n  вопрос: ${b.criticalQuestion}\n  ответ: ${b.trustedAnswer}\n  цитата (${b.evidence.speaker}): «${b.evidence.quote}»`,
    )
    .join('\n\n');

  return [
    'Ты — knowledge-инженер компании Z. Извлекаешь типизированные сущности из канонических IdeaBlock-ов одной встречи.',
    '',
    `Встреча: «${meetingTitle}»`,
    `Всего блоков: ${blocks.length}.`,
    '',
    'ОБЩИЕ ПРАВИЛА (для всех типов сущностей):',
    '- НЕ ВЫДУМЫВАЙ факты вне блоков. Если поля нет в источнике — null или пусто.',
    '- Все строки на русском.',
    '- Цитаты, имена, цифры берёшь только из блоков ниже.',
    '- ИСПОЛЬЗУЙ СОСЕДНИЕ БЛОКИ для глубины: если в твоём целевом блоке нет rationale, посмотри соседние с тем же контекстом — там может быть обоснование.',
    '- sourceBlockId — обязательное поле в каждой сущности.',
    '- confidence (0..1) — насколько уверен в извлечении.',
    '',
    'Все 55 блоков встречи (с этим контекстом ты работаешь во всех вызовах):',
    '',
    blocksContext,
  ].join('\n');
}

// ── tool-схемы (как в run-specialists.ts, для совместимости с judge) ────────
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
const KNOWLEDGE_CATEGORY_ITEM = {
  type: 'object',
  required: ['personName', 'category', 'confidence'],
  properties: {
    personName: { type: 'string' },
    category: { type: 'string' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    sampleStatements: { type: 'array', items: { type: 'string' } },
    sourceBlockIds: { type: 'array', items: { type: 'string' } },
  },
};
const SKILL_TRAIT_ITEM = {
  type: 'object',
  required: ['personName', 'category', 'statement', 'confidence'],
  properties: {
    personName: { type: 'string' },
    category: { type: 'string' },
    statement: { type: 'string' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    sourceBlockIds: { type: 'array', items: { type: 'string' } },
  },
};
const HELPFULNESS_TRAIT_ITEM = {
  type: 'object',
  required: ['sourceBlockId', 'traitType', 'helperUserHint', 'topicHint', 'intensity', 'confidence'],
  properties: {
    sourceBlockId: { type: 'string' },
    traitType: {
      type: 'string',
      enum: ['help_provided', 'proactive_hint', 'mentoring', 'emotional_support', 'constructive_feedback'],
    },
    helperUserHint: { type: 'string' },
    recipientUserHint: { type: ['string', 'null'] },
    topicHint: { type: 'string' },
    intensity: { type: 'number', minimum: 0, maximum: 1 },
    evidenceQuote: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

// ── задачи специалистов ─────────────────────────────────────────────────────
interface SpecialistTask {
  step: string;
  targetSignals: string[];
  toolName: string;
  taskInstruction: string;
  toolParams: Record<string, unknown>;
  entityKey: string;
}

const TASKS: SpecialistTask[] = [
  {
    step: '3-1 regulations',
    targetSignals: ['regulation', 'process_step'],
    toolName: 'submit_regulations',
    taskInstruction: `Ты — Specialist 3-1 (Regulations). Извлеки регламенты, процессы и политики из блоков с signalType ∈ {regulation, process_step} из общего контекста выше.

Для каждого подходящего блока заполни:
- kind: regulation (формальное правило), process (последовательность шагов), policy (правило с severity), standard (внешний стандарт).
- name (короткое название), statement (суть).
- ОБЯЗАТЕЛЬНО severity для kind='policy': advisory/mandatory/blocking.
- ИСПОЛЬЗУЙ соседние блоки для контекста — если регламент сформирован после инцидента (lesson), упомяни это в statement.
- sourceBlockId, confidence — обязательны.

Верни через submit_regulations.`,
    toolParams: {
      type: 'object',
      required: ['regulations'],
      properties: { regulations: { type: 'array', items: REGULATION_ITEM } },
    },
    entityKey: 'regulations',
  },
  {
    step: '3-3 decisions',
    targetSignals: ['decision', 'rationale'],
    toolName: 'submit_decisions',
    taskInstruction: `Ты — Specialist 3-3 (Decisions Registry). Извлеки решения из блоков с signalType ∈ {decision, rationale} из общего контекста выше.

Для каждого блока decision (rationale — это обоснование, объединяй с соседним decision):
- statement — суть решения одним предложением.
- ОБЯЗАТЕЛЬНО rationale — ПОЧЕМУ так решили. Ищи обоснование в соседних блоках с тем же контекстом (особенно signalType=rationale рядом). null только если в блоках ничего нет.
- ОБЯЗАТЕЛЬНО alternatives — какие варианты рассматривали и почему отвергли. Пустой массив, если не упоминалось.
- decidedBy — имена тех, кто принял.
- status: approved по умолчанию, иначе из текста.
- confidence.

Верни через submit_decisions.`,
    toolParams: {
      type: 'object',
      required: ['decisions'],
      properties: { decisions: { type: 'array', items: DECISION_ITEM } },
    },
    entityKey: 'decisions',
  },
  {
    step: '3-5 insights',
    targetSignals: ['pain', 'risk', 'blocker'],
    toolName: 'submit_insights',
    taskInstruction: `Ты — Specialist 3-5 (Insights Radar). Извлеки сигналы проблем из блоков с signalType ∈ {pain, risk, blocker} из общего контекста выше.

Для каждого блока:
- kind: problem/risk/blocker/inefficiency.
- statement.
- severity: low/medium/high/critical (medium по умолчанию, critical только если есть упоминание потери клиента/выручки/безопасности).
- ОБЯЗАТЕЛЬНО causeCategory (process_gap/tooling/role_skill/communication/priority/resource_constraint/external/unknown).
- ОБЯЗАТЕЛЬНО mitigationSuggestion — посмотри соседние блоки на тему «как с этим бороться». Если ничего нет — null, но проверь внимательно.
- sourceBlockId, confidence.

Верни через submit_insights.`,
    toolParams: {
      type: 'object',
      required: ['insights'],
      properties: { insights: { type: 'array', items: INSIGHT_ITEM } },
    },
    entityKey: 'insights',
  },
  {
    step: '3-6 ideas',
    targetSignals: ['idea', 'feature_request'],
    toolName: 'submit_ideas',
    taskInstruction: `Ты — Specialist 3-6 (Ideas Collector). Извлеки идеи из блоков с signalType ∈ {idea, feature_request} из общего контекста выше.

- kind: client_request если идея пришла от клиента/партнёра, иначе internal.
- statement (суть).
- ОБЯЗАТЕЛЬНО rationale — почему стоит сделать. Смотри соседние блоки (если рядом упомянуты pain или метрики — это контекст для rationale).
- sourceBlockId, confidence.

Верни через submit_ideas.`,
    toolParams: {
      type: 'object',
      required: ['ideas'],
      properties: { ideas: { type: 'array', items: IDEA_ITEM } },
    },
    entityKey: 'ideas',
  },
  {
    step: '3-9 experiments',
    targetSignals: ['hypothesis', 'result', 'lesson'],
    toolName: 'submit_experiments',
    taskInstruction: `Ты — Specialist 3-9 (Experiment Tracker). Извлеки эксперименты из блоков с signalType ∈ {hypothesis, result, lesson} из общего контекста выше.

ВАЖНО — связывание блоков: если рядом hypothesis + result + lesson описывают один и тот же эксперимент (например, Redis-кэш), ОБЪЕДИНИ их в одну запись. Если это разные эксперименты — отдельные записи.

Для каждого:
- name (≤80 символов).
- hypothesisText — что проверяли (НЕ пустое, если статус hypothesis/running).
- currentResult — что вышло (null если status=hypothesis).
- lessons[] — выводы с type (what_worked/what_failed/next_time). Включай ВСЕ соседние lesson-блоки этого эксперимента.
- status: hypothesis (ещё не запускали) / running (идёт без результата) / completed (есть result+lessons) / dropped / paused.
- sourceBlockId — id ПЕРВОГО блока (hypothesis обычно).
- confidence.

Верни через submit_experiments. Не выдумывай статус completed для блоков, где есть только гипотеза.`,
    toolParams: {
      type: 'object',
      required: ['experiments'],
      properties: { experiments: { type: 'array', items: EXPERIMENT_ITEM } },
    },
    entityKey: 'experiments',
  },
  {
    step: '3-2 knowledge-clone',
    targetSignals: ['expertise', 'experience', 'competence', 'reasoning'],
    toolName: 'submit_knowledge_categories',
    taskInstruction: `Ты — Specialist 3-2 (Knowledge Clone). Для каждой персоны из встречи извлеки 1-3 категории её знаний/опыта, опираясь на блоки с signalType ∈ {expertise, experience, competence, reasoning}, где этот человек упомянут.

Для каждой категории:
- personName — имя сотрудника.
- category — эмерджентная фраза (3-7 слов), не enum. Например: «архитектура AI-pipeline», «инцидент-менеджмент», «работа с легаси-кодом».
- confidence: high (4+ наблюдений), medium (2-3), low (1).
- sampleStatements — короткие цитаты-источники.
- sourceBlockIds — id блоков.

Объединяй похожие наблюдения. Не выдумывай категорий вне блоков. Верни через submit_knowledge_categories.`,
    toolParams: {
      type: 'object',
      required: ['categories'],
      properties: { categories: { type: 'array', items: KNOWLEDGE_CATEGORY_ITEM } },
    },
    entityKey: 'categories',
  },
  {
    step: '3-7 skill-traits',
    targetSignals: ['reasoning', 'methodology_step'],
    toolName: 'submit_skill_traits',
    taskInstruction: `Ты — Specialist 3-7 (SkillProfile). Для каждой персоны со множеством reasoning-блоков извлеки 1-2 ЭМЕРДЖЕНТНЫЕ черты её рабочего ПОДХОДА К РЕШЕНИЯМ.

Категория — короткая фраза-метка (3-6 слов): «осторожен с легаси», «требует данных перед решением». НЕ enum.
Statement — ГИПОТЕЗА с qualifier: «Похоже, склонен...», «В большинстве случаев...». Никаких приговорных утверждений.
Confidence: low (1-2 наблюдения), medium (3-5), high (6+).

Источник — ТОЛЬКО reasoning-блоки этого человека. Если в reasoning нет ПОЧЕМУ — НЕ извлекать (sourceBlockIds=[]).

Верни через submit_skill_traits.`,
    toolParams: {
      type: 'object',
      required: ['traits'],
      properties: { traits: { type: 'array', items: SKILL_TRAIT_ITEM } },
    },
    entityKey: 'traits',
  },
  {
    step: '3-8 helpfulness',
    targetSignals: ['help_provided', 'proactive_hint', 'mentoring', 'emotional_support'],
    toolName: 'submit_helpfulness_traits',
    taskInstruction: `Ты — Specialist 3-8 (Helpfulness Agent). Извлеки паттерны помощи из блоков с signalType ∈ {help_provided, proactive_hint, mentoring, emotional_support}.

Для каждого блока — 0..3 trait'а:
- traitType: help_provided/proactive_hint/mentoring/emotional_support/constructive_feedback.
- helperUserHint — имя помогающего.
- recipientUserHint — кому помогли (опц.).
- topicHint — короткая тема (3-7 слов): «архитектура React», «найм фронтенда».
- intensity: 0.3 эпизодическое, 0.6 развёрнутое, 0.9 глубокий менторинг.
- evidenceQuote — точная цитата (≤300 знаков).
- sourceBlockId, confidence.

Верни через submit_helpfulness_traits.`,
    toolParams: {
      type: 'object',
      required: ['traits'],
      properties: { traits: { type: 'array', items: HELPFULNESS_TRAIT_ITEM } },
    },
    entityKey: 'traits',
  },
];

// ── вызов ────────────────────────────────────────────────────────────────────
interface CallReport {
  step: string;
  ok: boolean;
  ms: number;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  cacheHitRatio: number;
  costUsd: number;
  entitiesExtracted: number;
  error?: string;
  output?: unknown;
}

async function callSpecialist(
  cachePrefix: string,
  task: SpecialistTask,
): Promise<CallReport> {
  console.log(`  → ${task.step}…`);
  const start = Date.now();
  let usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
    cached_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  } = {};
  let output: unknown = undefined;
  let error: string | undefined;
  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: cachePrefix },
        { role: 'user', content: task.taskInstruction },
      ],
      max_tokens: MAX_TOKENS,
      tools: [
        {
          type: 'function',
          function: {
            name: task.toolName,
            description: `Отдать результат специалиста ${task.step}.`,
            parameters: task.toolParams,
          },
        },
      ],
      tool_choice: 'auto',
    } as Parameters<typeof client.chat.completions.create>[0])) as unknown as {
      choices: Array<{
        message?: { content?: string | null; tool_calls?: Array<{ function: { arguments: string } }> };
      }>;
      usage?: typeof usage;
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
        output = { rawArgs: call.function.arguments };
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
  const costUsd = uncached * PRICE_IN + cachedTokens * PRICE_CACHED_IN + tokensOut * PRICE_OUT;
  const cacheHitRatio = tokensIn > 0 ? cachedTokens / tokensIn : 0;

  let entitiesExtracted = 0;
  if (output && typeof output === 'object') {
    const arr = (output as Record<string, unknown>)[task.entityKey];
    if (Array.isArray(arr)) entitiesExtracted = arr.length;
  }
  console.log(
    `    ${error ? '✗' : '✓'} ${ms} мс | вход=${tokensIn} (кэш=${cachedTokens}, ${(cacheHitRatio * 100).toFixed(0)}%) выход=${tokensOut} | $${costUsd.toFixed(4)} | сущностей=${entitiesExtracted}${error ? ` | ${error}` : ''}`,
  );
  return {
    step: task.step,
    ok: !error,
    ms,
    tokensIn,
    tokensOut,
    cachedTokens,
    cacheHitRatio,
    costUsd,
    entitiesExtracted,
    error,
    output,
  };
}

async function main(): Promise<void> {
  console.log('=== Variant Г — 8 специалистов с общим кэш-префиксом ===');
  console.log(`  модель: ${MODEL}`);
  console.log(`  фикстура: ${path.basename(FIXTURE_PATH)}\n`);
  const fixture: Fixture = JSON.parse(await fs.readFile(FIXTURE_PATH, 'utf-8'));
  console.log(`  блоков всего: ${fixture.blocks.length}`);

  const cachePrefix = buildCachePrefix(fixture.blocks, fixture.meetingTitle);
  console.log(`  общий префикс: ${cachePrefix.length} знаков (≈${Math.round(cachePrefix.length / 4)} токенов)`);

  // Warm-up: первый вызов "греет" кэш. Делаем 3-3 первым (большой батч,
  // максимальный шанс на быстрое прогревание).
  console.log('\n→ warm-up (первый вызов — заполняет кэш):');
  const firstTask = TASKS.find((t) => t.step === '3-3 decisions')!;
  const firstReport = await callSpecialist(cachePrefix, firstTask);

  // Остальные 7 параллельно — должны получить кэш-хит.
  console.log('\n→ параллельно: 7 остальных специалистов (ожидается cache hit ≥90%):');
  const restTasks = TASKS.filter((t) => t.step !== firstTask.step);
  const totalStart = Date.now();
  const restReports = await Promise.all(restTasks.map((t) => callSpecialist(cachePrefix, t)));
  const totalMs = Date.now() - totalStart;

  const allReports = [firstReport, ...restReports];
  const tokensIn = allReports.reduce((s, r) => s + r.tokensIn, 0);
  const tokensOut = allReports.reduce((s, r) => s + r.tokensOut, 0);
  const cached = allReports.reduce((s, r) => s + r.cachedTokens, 0);
  const costUsd = allReports.reduce((s, r) => s + r.costUsd, 0);
  const entities = allReports.reduce((s, r) => s + r.entitiesExtracted, 0);
  const fails = allReports.filter((r) => !r.ok).length;
  const avgCacheHit = allReports.reduce((s, r) => s + r.cacheHitRatio, 0) / allReports.length;

  console.log('\n=== Итоги ===');
  console.log(`  вызовов: ${allReports.length}  (упало: ${fails})`);
  console.log(`  суммарное время: ${firstReport.ms + totalMs} мс (warm-up ${firstReport.ms} + остальные параллельно ${totalMs})`);
  console.log(`  токены: вход=${tokensIn} (кэш=${cached}, ${(avgCacheHit * 100).toFixed(0)}% средн.) выход=${tokensOut}`);
  console.log(`  стоимость:     $${costUsd.toFixed(4)}`);
  console.log(`  сущностей всего: ${entities}`);

  await fs.writeFile(
    REPORT_PATH,
    JSON.stringify(
      {
        variant: 'G',
        fixtureId: fixture.fixtureId,
        model: MODEL,
        totalMs: firstReport.ms + totalMs,
        totalTokensIn: tokensIn,
        totalTokensOut: tokensOut,
        totalCachedTokens: cached,
        avgCacheHitRatio: avgCacheHit,
        totalCostUsd: costUsd,
        totalEntities: entities,
        steps: allReports,
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
