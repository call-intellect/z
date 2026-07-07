/**
 * Словарь «код `SignalType` → человеческий русский ярлык» + хелпер `signalTypeLabel`.
 *
 * Назначение. Ни один LLM-промпт модуля усвоения не должен получать на вход
 * машинный код сигнала (`pain`, `churn_risk`, `task_overdue`…). Жёсткое
 * требование методологии промптов Z №3 (docs/methodology/prompts/README.md):
 * подавать модели человеческий ярлык. Иначе промпт сам себе противоречит
 * (запрещает коды в выходе, но кормит ими на входе) и код утекает в UI
 * конечного пользователя.
 *
 * Единый источник правды для 4 точек сборки USER-строк ingest-промптов:
 *   1. `axis-classify` (USER-builder),
 *   2. `summariseBlock` в `block-merge.service.ts` (block-distill),
 *   3. `summariseBlock` в `block-link.service.ts` (block-linker),
 *   4. `formatBlockForCombined` в `specialists-combined.prompt.ts` (специалист-routing).
 *
 * Живёт РЯДОМ с промптами (`knowledge-core/prompts`), а не в общем
 * `ai/services/prompts/common.ts` — чтобы не тянуть knowledge-core-специфику
 * в общий слой. ТЗ 2026-06-16 (knowledge-core-ingest-prompts) Ф4-pre.
 *
 * ВАЖНО: ключи синхронизированы с enum `SignalType` (`backend/prisma/schema.prisma`).
 * Появился новый `SignalType` — добавь сюда строку с русским ярлыком; полнота
 * проверяется машинным гардом `signal-type-label.spec.ts`
 * (`Object.values(SignalType)` ⊆ ключи словаря).
 */
export const SIGNAL_TYPE_LABEL: Record<string, string> = {
  fact: 'факт',
  pain: 'боль, проблема в работе',
  feature_request: 'запрос новой возможности',
  objection: 'возражение (в продаже)',
  churn_risk: 'риск ухода клиента',
  idea: 'идея, предложение на будущее',
  risk: 'риск',
  commitment: 'взятое обязательство',
  decision: 'принятое решение',
  mood: 'настроение',
  drift: 'отклонение от плана',
  competitor_move: 'действие конкурента',
  metric_change: 'изменение метрики',
  knowledge_gap: 'пробел в знаниях',
  reasoning: 'ход рассуждения',
  rationale: 'обоснование решения',
  decision_basis: 'основание для решения',
  regulation: 'регламент/правило',
  process_step: 'шаг процесса',
  expertise: 'экспертиза',
  experience: 'накопленный опыт',
  competence: 'компетенция/навык',
  methodology_step: 'шаг методологии',
  hypothesis: 'гипотеза',
  result: 'достигнутый результат',
  lesson: 'извлечённый урок',
  brand_principle: 'принцип бренда',
  content_artifact: 'контент-артефакт',
  commitment_status: 'статус обязательства',
  plan_item: 'пункт плана',
  action_item: 'задача к исполнению',
  done_item: 'выполненный пункт',
  blocker: 'блокер',
  team_friction: 'трение в команде',
  process_friction: 'трение в процессе',
  resource_gap: 'нехватка ресурса',
  suggestion: 'пожелание/совет',
  client_request: 'запрос клиента',
  question: 'вопрос',
  task_created: 'задача заведена',
  task_status_changed: 'сменился статус задачи',
  task_blocked: 'задача заблокирована',
  task_completed: 'задача выполнена',
  task_overdue: 'задача просрочена',
  task_reassigned: 'задачу переназначили',
  task_comment: 'комментарий к задаче',
  task_mention: 'упоминание в задаче',
  help_provided: 'оказана помощь',
  proactive_hint: 'проактивная подсказка',
  mentoring: 'наставничество',
  emotional_support: 'эмоциональная поддержка',
  constructive_feedback: 'конструктивная обратная связь',
  question_unanswered: 'вопрос без ответа',
  question_acknowledged_no_action: 'вопрос услышан, без действий',
  helped_by: 'кому-то помогли',
  helped_to: 'кому помог',
  thanks_explicit: 'явная благодарность',
};

/**
 * Человеческий ярлык по коду сигнала. Fallback — сам код (чтобы новый, ещё не
 * залейбленный `SignalType` не «исчезал» из контекста промпта, а был виден как
 * есть; машинный гард в тесте всё равно заставит добавить ярлык).
 */
export function signalTypeLabel(code: string): string {
  return SIGNAL_TYPE_LABEL[code] ?? code;
}

// ─────────────────── ярлыки enum связей целей/сигналов (ТЗ 2026-06-16, пачка 6) ───
//
// Те же требования методологии №3, что и у SIGNAL_TYPE_LABEL: промптам-связям
// модуля усвоения подаём человеческий ярлык, а не машинный код enum.
// Fallback — сам код (новый enum-член не исчезает из контекста промпта).
// Ключи синхронизированы с enum в backend/prisma/schema.prisma.

/** Русские ярлыки горизонтов целей (enum `GoalHorizon`). */
export const GOAL_HORIZON_LABEL_RU: Record<string, string> = {
  strategic: 'стратегическая',
  annual: 'годовая',
  quarterly: 'квартальная',
  monthly: 'месячная',
  sprint: 'спринтовая',
};

/** Ярлык горизонта цели для промпта; fallback на сам код. */
export function goalHorizonLabelRu(code: string): string {
  return GOAL_HORIZON_LABEL_RU[code] ?? code;
}

/** Русские ярлыки видов сигнала-боли (enum `InsightKind`). */
export const INSIGHT_KIND_LABEL_RU: Record<string, string> = {
  problem: 'проблема',
  risk: 'риск',
  blocker: 'блокер',
  inefficiency: 'неэффективность',
};

/** Ярлык вида сигнала для промпта; fallback на сам код. */
export function insightKindLabelRu(code: string): string {
  return INSIGHT_KIND_LABEL_RU[code] ?? code;
}

/** Русские ярлыки статусов решения (enum `DecisionStatus`, все 8 значений). */
export const DECISION_STATUS_LABEL_RU: Record<string, string> = {
  active: 'действует',
  rolled_back: 'откатано',
  superseded: 'заменено',
  proposed: 'предложено',
  approved: 'утверждено',
  rejected: 'отклонено',
  implemented: 'внедрено',
  cancelled: 'отменено',
};

/** Ярлык статуса решения для промпта; fallback на сам код. */
export function decisionStatusLabelRu(code: string): string {
  return DECISION_STATUS_LABEL_RU[code] ?? code;
}

/**
 * Русские ярлыки типов орг-документа (kind компилятора документа,
 * `structured-document-compiler`). Технический код kind остаётся ключом
 * маршрутизации к структуре, а человеку в промпт подаём ярлык.
 */
export const ORG_DOCUMENT_KIND_LABEL_RU: Record<string, string> = {
  regulation: 'Регламент',
  process: 'Описание процесса',
  policy: 'Политика',
  instruction: 'Инструкция',
  task_solution: 'Решение задачи',
};

/** Ярлык типа орг-документа для промпта; fallback на сам код. */
export function orgDocumentKindLabelRu(code: string): string {
  return ORG_DOCUMENT_KIND_LABEL_RU[code] ?? code;
}

// ─────────────────── ярлыки enum кластеризации/сводки (ТЗ 2026-06-16, пачка 7) ────
//
// Те же требования методологии №3: промптам кластеризации/роллапа подаём
// человеческий ярлык, а не машинный код enum. Fallback — сам код. Ключи
// синхронизированы с enum в backend/prisma/schema.prisma и доменом фронта.

/**
 * Русские ярлыки видов сущности (enum `EntityType`). Подаётся в USER-строку
 * theme-classify вместо машинного `type` (`customer`, `org_unit`…). deprecated
 * `client` маппится на тот же ярлык, что `customer`.
 * Источник-зеркало — `frontend/src/domain/entity.ts` ENTITY_TYPE_LABEL.
 */
export const ENTITY_TYPE_LABEL_RU: Record<string, string> = {
  person: 'человек',
  customer: 'заказчик',
  vendor: 'поставщик',
  project: 'проект',
  product: 'продукт',
  document: 'документ',
  goal: 'цель',
  event: 'событие',
  topic: 'тема',
  location: 'место',
  technology: 'технология',
  metric: 'показатель',
  market: 'рынок',
  org_unit: 'подразделение',
  client: 'заказчик',
};

/** Ярлык вида сущности для промпта; fallback на сам код. */
export function entityTypeLabelRu(code: string): string {
  return ENTITY_TYPE_LABEL_RU[code] ?? code;
}

/**
 * Русские ярлыки видов карточки (`Card.kind`, `CardRollupV2Kind`). Подаётся в
 * USER-строку card-rollup-v2 вместо машинного `kind`. deprecated/legacy и
 * неизвестные kind → fallback на сам код (промпт-фоллбэк kind = custom).
 */
export const CARD_KIND_LABEL_RU: Record<string, string> = {
  client: 'клиент',
  deal: 'сделка',
  project: 'проект',
  topic: 'тема/область знаний',
  vendor: 'поставщик',
  custom: 'произвольный кейс',
};

/** Ярлык вида карточки для промпта; fallback на сам код. */
export function cardKindLabelRu(code: string): string {
  return CARD_KIND_LABEL_RU[code] ?? code;
}

/**
 * Русские ярлыки статусов идеи (enum `IdeaStatus`). Подаётся в USER-строку
 * idea-status-summarize вместо машинных кодов (`captured`, `in_progress`…).
 * Источник-зеркало — `frontend/src/domain/idea.ts` IDEA_STATUS_LABEL.
 */
export const IDEA_STATUS_LABEL_RU: Record<string, string> = {
  captured: 'Зафиксирована',
  in_discussion: 'Обсуждается',
  accepted: 'Принята',
  in_progress: 'В работе',
  shipped: 'Выпущена',
  rejected: 'Отклонена',
  archived: 'В архиве',
};

/** Ярлык статуса идеи для промпта; fallback на сам код. */
export function ideaStatusLabelRu(code: string): string {
  return IDEA_STATUS_LABEL_RU[code] ?? code;
}

// ─────────────────── ярлыки категории регламента (ТЗ 2026-06-16, пачка 5) ─────────
//
// Те же требования методологии №3: арбитру `regulation-dedupe` в USER-строку
// подаём человеческий ярлык категории черновика, а не латинский код `kind`
// (`regulation`, `process`…), иначе код утекает в контекст модели и в UI.
// Отдельно от `ORG_DOCUMENT_KIND_LABEL_RU` (компилятор орг-документа, иной
// набор/регистр): здесь — строчные ярлыки и значение `standard`. Fallback —
// сам код. ТЗ dedup/supersede Ф0.

/** Русские ярлыки категорий регламента (поле `kind` карточки правила). */
export const REGULATION_KIND_LABEL_RU: Record<string, string> = {
  regulation: 'регламент',
  process: 'процесс',
  policy: 'политика',
  standard: 'стандарт',
  instruction: 'инструкция',
};

/** Ярлык категории регламента для промпта; fallback на сам код. */
export function regulationKindLabel(kind: string): string {
  return REGULATION_KIND_LABEL_RU[kind] ?? kind;
}
