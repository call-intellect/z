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
