/**
 * Query Understanding Волна 1 (ТЗ 2026-06-10 Tier 0) — промпт для
 * QueryPlanExtractorService (taskType `dialog-extract-plan`).
 *
 * Задача: разобрать вопрос пользователя к AI-чату компании на оси —
 * период / типы сигналов / ветки тем / сущности / «я» / агрегация /
 * нужно-действие — для последующей recall-safe фильтрации retrieval.
 *
 * CACHE-FRIENDLY (см. second-brain/02_architecture/llm-cache-status.md):
 * SYSTEM-промпт СТАБИЛЬНЫЙ — внутри НЕТ даты. Дата и таймзона уходят в
 * USER-часть (buildExtractPlanUserPrompt), вопрос — в самом конце. Правка
 * SYSTEM инвалидирует prompt cache (flash кэширует SYSTEM с hit ≈99%).
 *
 * T7-F6: JSON Schema strict для DeepSeek/OpenAI. Ollama выдаст
 * LlmFormatNotSupportedError → LlmRouter перейдёт на следующего провайдера.
 */

export const EXTRACT_PLAN_SYSTEM_PROMPT = `Ты — анализатор структуры вопроса пользователя к AI-чату компании Кора.
Твоя задача — разобрать вопрос на оси и вернуть СТРОГО JSON-план,
по которому система сузит поиск по графу знаний. Ты НЕ отвечаешь на
вопрос — только извлекаешь его структуру.

Правило-инвариант: если ось в вопросе ОТСУТСТВУЕТ — верни пустое
значение (пустой массив / "none" / false / null). НИКОГДА не выдумывай
значения, которых нет в перечислённых ниже наборах.

──────────────────────────────────────────────────────────────────
ОСЬ 1 — periodExpr (период времени)

Один токен из набора:
  this_week, last_week, yesterday, today, this_month, last_month,
  last_n_days, none

Маппинг русских фраз:
  • «эта неделя», «на этой неделе» → this_week
  • «прошлая неделя», «на прошлой неделе» → last_week
  • «вчера» → yesterday
  • «сегодня» → today
  • «этот месяц», «в этом месяце» → this_month
  • «прошлый месяц», «в прошлом месяце» → last_month
  • «за последние N дней», «за последние N суток», «за месяц»
    (как «за последние 30 дней») → last_n_days + periodDays

periodDays — целое число дней для last_n_days, иначе null. Для
«за месяц» периодом скользящего окна ставь last_n_days + periodDays=30.

Если в вопросе НЕТ упоминания времени — periodExpr="none".
Если период есть, но он НЕ ПОДДЕРЖАН (например «квартал», «год»,
«план на квартал», «за полгода», конкретные даты) — тоже "none".
В случае "none" periodDays = null.

──────────────────────────────────────────────────────────────────
ОСЬ 2 — signalTypes (типы сигналов знаний)

Массив из 0+ значений СТРОГО из набора типов сигналов (если нет
упоминания — пустой массив []). Подсказки маппинга:
  • «решали», «решение», «что решили» → decision
  • «дела», «задачи», «что делаем» → task_created, task_completed,
    commitment, plan_item
  • «риски» → risk, churn_risk
  • «блокеры», «что мешает» → blocker
  • «идеи» → idea
  • «запрос клиента», «что просил клиент» → client_request

Бери ТОЛЬКО типы из официального enum (см. JSON-схему). Если тип
сигнала в вопросе не упомянут — верни [].

──────────────────────────────────────────────────────────────────
ОСЬ 3 — themeBranches (ветки тем / отделы)

Массив из 0+ значений СТРОГО из набора:
  strategy, clients, sales, marketing, product, operations, team,
  finance, technology, production, partnerships, legal

Маппинг:
  • «маркетинг» → marketing
  • «продажи» → sales
  • «продукт» → product
  • «финансы», «бюджет», «деньги» → finance
  • «команда», «HR», «найм», «люди» → team
  • «операции», «процессы» → operations
  • «юр», «legal», «договор», «право» → legal
  • «стратегия» → strategy
  • «клиенты» → clients
  • «технологии», «разработка» → technology
  • «производство» → production
  • «партнёры» → partnerships

Если отдел/тема не упомянуты — верни [].

──────────────────────────────────────────────────────────────────
ОСЬ 4 — entityHints (имена собственные)

Массив подсказок-имён собственных (клиенты, компании, люди,
проекты), упомянутых в вопросе, КАК НАПИСАНО (без нормализации).
Если имён собственных нет — верни [].

──────────────────────────────────────────────────────────────────
ОСЬ 5 — personScope («я»)

true, если вопрос про самого спрашивающего: «я», «мой», «мне»,
«меня», «у меня» (первое лицо о себе). Иначе false.

──────────────────────────────────────────────────────────────────
ОСЬ 6 — aggregation (агрегирующий вопрос)

true, если есть «сколько», «сумма», «самый», «количество», «больше
всего». Иначе false.

──────────────────────────────────────────────────────────────────
ОСЬ 7 — needsAction (нужен совет/действие)

true, если просят действие: «предложи», «что делать», «посоветуй»,
«как поступить». Иначе false.

──────────────────────────────────────────────────────────────────
ОСЬ 8 — activeNow (текущее/действующее состояние сейчас)

true, если пользователь спрашивает про ТЕКУЩЕЕ/действующее состояние
сейчас: «сейчас», «на данный момент», «актуальные», «действующие»,
«текущие». Иначе false.

──────────────────────────────────────────────────────────────────
confidence — твоя уверенность в извлечённом плане, число 0..1.
  • 0.9-1.0 — оси явные, фразы однозначные.
  • 0.6-0.89 — уверен, но одна из осей под вопросом.
  • <0.6 — почти угадываешь (система проигнорирует слабый план).

──────────────────────────────────────────────────────────────────
ФОРМАТ ОТВЕТА

Отвечай СТРОГО в JSON, без markdown-блоков, без префиксов, без
пояснений. Все поля обязательны:

{"periodExpr":"<токен>","periodDays":<число|null>,"signalTypes":[...],"themeBranches":[...],"entityHints":[...],"personScope":<bool>,"aggregation":<bool>,"needsAction":<bool>,"activeNow":<bool>,"confidence":<0..1>}`;

/**
 * Полный список значений SignalType (зеркало enum в schema.prisma /
 * @prisma/client). Хардкод в схеме нужен для strict json_schema (provider
 * требует явный enum). При изменении SignalType — обновить здесь вручную;
 * сервис дополнительно санитизирует ответ по runtime-`Object.values($Enums.SignalType)`,
 * так что рассинхрон не приведёт к невалидным данным, только к чуть менее
 * точной подсказке модели.
 */
const SIGNAL_TYPE_ENUM = [
  'fact',
  'pain',
  'feature_request',
  'objection',
  'churn_risk',
  'idea',
  'risk',
  'commitment',
  'decision',
  'mood',
  'drift',
  'competitor_move',
  'metric_change',
  'knowledge_gap',
  'reasoning',
  'rationale',
  'decision_basis',
  'regulation',
  'process_step',
  'expertise',
  'experience',
  'competence',
  'methodology_step',
  'hypothesis',
  'result',
  'lesson',
  'brand_principle',
  'content_artifact',
  'commitment_status',
  'plan_item',
  'done_item',
  'blocker',
  'team_friction',
  'process_friction',
  'resource_gap',
  'suggestion',
  'client_request',
  'question',
  'task_created',
  'task_status_changed',
  'task_blocked',
  'task_completed',
  'task_overdue',
  'task_reassigned',
  'task_comment',
  'task_mention',
  'help_provided',
  'proactive_hint',
  'mentoring',
  'emotional_support',
  'constructive_feedback',
  'question_unanswered',
  'question_acknowledged_no_action',
  'helped_by',
  'helped_to',
  'thanks_explicit',
] as const;

const THEME_BRANCH_ENUM = [
  'strategy',
  'clients',
  'sales',
  'marketing',
  'product',
  'operations',
  'team',
  'finance',
  'technology',
  'production',
  'partnerships',
  'legal',
] as const;

/**
 * JSON Schema для `responseFormat: json_schema strict`. Все поля обязательны,
 * `additionalProperties: false`. Хардкод (не через z.toJSONSchema) —
 * читается проще и порядок enum стабилен (важно для prompt cache).
 */
export const EXTRACT_PLAN_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    periodExpr: {
      type: 'string',
      enum: [
        'this_week',
        'last_week',
        'yesterday',
        'today',
        'this_month',
        'last_month',
        'last_n_days',
        'none',
      ],
    },
    periodDays: {
      type: ['integer', 'null'],
    },
    signalTypes: {
      type: 'array',
      items: {
        type: 'string',
        enum: [...SIGNAL_TYPE_ENUM],
      },
    },
    themeBranches: {
      type: 'array',
      items: {
        type: 'string',
        enum: [...THEME_BRANCH_ENUM],
      },
    },
    entityHints: {
      type: 'array',
      items: { type: 'string' },
    },
    personScope: { type: 'boolean' },
    aggregation: { type: 'boolean' },
    needsAction: { type: 'boolean' },
    activeNow: { type: 'boolean' },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
    },
  },
  required: [
    'periodExpr',
    'periodDays',
    'signalTypes',
    'themeBranches',
    'entityHints',
    'personScope',
    'aggregation',
    'needsAction',
    'activeNow',
    'confidence',
  ],
  additionalProperties: false,
};

/**
 * USER-часть: дата + таймзона + вопрос. Cache-safe — переменная часть в
 * конце, SYSTEM не трогаем. Вопрос — последним.
 */
export function buildExtractPlanUserPrompt(args: {
  question: string;
  todayIso: string;
  orgTimezone: string;
}): string {
  return `Сегодня: ${args.todayIso}. Таймзона компании: ${args.orgTimezone}.\nВопрос: ${args.question}\n\nПлан:`;
}
