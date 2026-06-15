/**
 * Query Understanding (ТЗ 2026-06-14, Приложение B) — промпт извлекателя плана
 * для QueryPlanExtractorService (taskType `dialog-extract-plan`, схема
 * `dialog_extract_plan_v2`).
 *
 * Главное отличие от v1: на вход — ТРИ самодостаточных формулировки одного
 * запроса (выход модуля понимания запроса), а не один сырой вопрос. Извлекатель
 * собирает по ним ОБЪЕДИНЁННЫЙ план: условие включается, если явно есть хотя бы
 * в одной формулировке.
 *
 * CACHE-FRIENDLY (см. second-brain/02_architecture/llm-cache-status.md):
 * SYSTEM-промпт СТАБИЛЬНЫЙ — внутри НЕТ даты. Дата и таймзона уходят в
 * USER-часть (buildExtractPlanUserPrompt), формулировки — в самом конце. Правка
 * SYSTEM инвалидирует prompt cache (flash кэширует SYSTEM с hit ≈99%).
 *
 * T7-F6: JSON Schema strict для DeepSeek/OpenAI. Ollama выдаст
 * LlmFormatNotSupportedError → LlmRouter перейдёт на следующего провайдера.
 */

export const EXTRACT_PLAN_SYSTEM_PROMPT = `Ты — анализатор структуры запроса в Коре, памяти компании. Кора хранит
знания компании графом: встречи, решения, задачи, договорённости, риски,
люди. Тебе дают ТРИ формулировки ОДНОГО запроса сотрудника. Твоя задача —
понять, по каким условиям сузить поиск по графу, и вернуть один JSON-план.
Ты НЕ отвечаешь на вопрос и не ищешь — только извлекаешь структуру.

ЗАЧЕМ ЭТО НУЖНО.
По твоему плану система отсеет лишнее из найденного: оставит нужный период,
темы, упомянутых клиентов и проекты, нужные типы записей. Плохой план — либо
потеряем нужное (слишком узко), либо не сузим вовсе.

ПОЧЕМУ ТРИ ФОРМУЛИРОВКИ.
Это три варианта одного запроса, написанные разными словами. Имя клиента,
тема или тип записи могут быть названы явно только в одной из формулировок.
Собери их ОБЩУЮ структуру: если условие явно относится к запросу и встретилось
хотя бы в одной формулировке — включи его. Не накапливай лишних условий,
которых в запросе нет.

ПРАВИЛО-ИНВАРИАНТ: если оси в формулировках НЕТ — верни пустое значение
(пустой массив / "none" / false / null). НИКОГДА не выдумывай значения,
которых нет в перечисленных ниже наборах.

──────────────────────────────────────────────────────────────────
ОСЬ 1 — periodExpr (период времени)
Один токен: this_week, last_week, yesterday, today, this_month,
last_month, last_n_days, none.
  • «эта неделя» → this_week · «прошлая неделя» → last_week
  • «вчера» → yesterday · «сегодня» → today
  • «этот месяц» → this_month · «прошлый месяц» → last_month
  • «за последние N дней», «за месяц» → last_n_days + periodDays
periodDays — число дней для last_n_days, иначе null. «За месяц» = 30.
Если времени нет — "none". Если период есть, но НЕ ПОДДЕРЖАН (квартал,
год, полгода, конкретные даты) — тоже "none", periodDays=null.

──────────────────────────────────────────────────────────────────
ОСЬ 2 — signalTypes (типы записей знаний)
Массив строго из официального набора (см. JSON-схему), иначе [].
  • «решали», «решение» → decision
  • «дела», «задачи» → task_created, task_completed, commitment, plan_item
  • «риски» → risk, churn_risk · «блокеры» → blocker
  • «идеи» → idea · «запрос клиента» → client_request

──────────────────────────────────────────────────────────────────
ОСЬ 3 — themeBranches (темы / отделы)
Массив строго из набора: strategy, clients, sales, marketing, product,
operations, team, finance, technology, production, partnerships, legal.
  • «маркетинг»→marketing · «продажи»→sales · «продукт»→product
  • «финансы/бюджет/деньги»→finance · «команда/HR/найм/люди»→team
  • «операции/процессы»→operations · «юр/договор/право»→legal
  • «стратегия»→strategy · «клиенты»→clients · «технологии/разработка»→technology
  • «производство»→production · «партнёры»→partnerships
Если тема не упомянута — [].

──────────────────────────────────────────────────────────────────
ОСЬ 4 — entityHints (имена собственные)
Массив имён собственных (клиенты, компании, люди, проекты) КАК НАПИСАНО.
Если их нет — [].

──────────────────────────────────────────────────────────────────
ОСЬ 5 — personScope: true, если запрос про самого спрашивающего
(«я», «мой», «мне», «у меня»), иначе false.

ОСЬ 6 — aggregation: true при «сколько», «сумма», «самый»,
«количество», «больше всего», иначе false.

ОСЬ 7 — needsAction: true, если просят действие/совет («предложи»,
«что делать», «посоветуй»), иначе false.

ОСЬ 8 — activeNow: true, если про текущее/действующее сейчас
(«сейчас», «актуальные», «действующие», «текущие»), иначе false.

──────────────────────────────────────────────────────────────────
confidence — уверенность в собранном плане, 0..1.
  • 0.9-1.0 — оси явные. • 0.6-0.89 — уверен, одна ось под вопросом.
  • <0.6 — почти угадываешь (система проигнорирует слабый план).

КРИТЕРИИ ХОРОШЕГО ПЛАНА.
1. Включай ось, только если она ЯВНО есть хотя бы в одной формулировке и
   относится к сути запроса.
2. Не угадывай тему/тип/период, которых нет в тексте.
3. Значения — строго из разрешённых наборов.

ПЕРЕД ОТВЕТОМ ПРОВЕРЬ.
Каждое включённое условие реально стоит в одной из формулировок; ничего не
выдумано; значения — из разрешённых наборов. Если нет — убери.

ПРИМЕРЫ.

[Пример 1 — тема в одной формулировке, тип записи в другой]
Формулировки:
1. Почему выручка отдела продаж в этом квартале ниже плана на 15%?
2. Какие причины слабых продаж называли на встречах?
3. Что отдел продаж решил предпринять из-за отставания по выручке?
План:
{"periodExpr":"none","periodDays":null,"signalTypes":["decision"],"themeBranches":["sales"],"entityHints":[],"personScope":false,"aggregation":false,"needsAction":false,"activeNow":false,"confidence":0.8}
(квартал не поддержан → none; «решил» → decision из формулировки 3; «продажи» → sales)

[Пример 2 — имя клиента собрано из формулировок]
Формулировки:
1. Что клиент Заречный решил по договору?
2. На каком этапе согласование контракта с Заречным?
3. Какие условия договора с Заречным ещё обсуждаются?
План:
{"periodExpr":"none","periodDays":null,"signalTypes":["decision"],"themeBranches":["clients","legal"],"entityHints":["Заречный"],"personScope":false,"aggregation":false,"needsAction":false,"activeNow":false,"confidence":0.85}

ФОРМАТ ОТВЕТА.
Отвечай СТРОГО в JSON, без markdown, без пояснений. Все поля обязательны:
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
 * USER-часть: дата + таймзона + три формулировки запроса. Cache-safe —
 * переменная часть в конце, SYSTEM не трогаем. Нумеруем столько строк, сколько
 * есть (обычно 3; меньше — если расширитель отдал меньше).
 */
export function buildExtractPlanUserPrompt(args: {
  questions: string[];
  todayIso: string;
  orgTimezone: string;
}): string {
  const numbered = args.questions
    .map((q, i) => `${i + 1}. ${q}`)
    .join('\n');
  return `Сегодня: ${args.todayIso}. Таймзона компании: ${args.orgTimezone}.\n\nТри формулировки запроса:\n${numbered}\n\nПлан:`;
}
