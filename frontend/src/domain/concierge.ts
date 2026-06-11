/**
 * Domain (UiModel) для Concierge — человекочитаемые лейблы инструментов.
 *
 * Сырые `toolName` приходят латиницей из backend tool-router
 * (`backend/src/modules/concierge/services/service-map-generator.service.ts`).
 * В UI их показываем по-русски, чтобы не протекала латиница.
 *
 * Ключи словаря — английские `toolName` (стабильный контракт backend);
 * видимый текст — русский. Неизвестный инструмент (backend добавил раньше
 * фронта) → человеческий фолбэк `name.replaceAll('_', ' ')`.
 */

const TOOL_NAME_LABEL: Record<string, string> = {
  // Встречи
  list_meetings: 'Смотрю встречи',
  create_meeting: 'Создаю встречу',
  cancel_meeting: 'Отменяю встречу',
  // Знания / память
  search_knowledge: 'Ищу в памяти компании',
  // Задачи
  list_tasks: 'Смотрю задачи',
  list_overdue_promises: 'Смотрю просроченные обещания',
  // Календарь / события
  create_event: 'Создаю событие в календаре',
  list_my_events: 'Смотрю мои события',
  list_user_events: 'Смотрю события сотрудника',
  find_free_slot: 'Ищу свободное время',
  delete_event: 'Удаляю событие',
  // Клоны ролей
  ask_role_clone: 'Спрашиваю клон роли',
  list_clones: 'Смотрю клоны ролей',
  // Аналитика
  get_person_pulse: 'Смотрю пульс сотрудника',
  get_sprint_status: 'Смотрю статус спринта',
  get_team_health: 'Смотрю здоровье команды',
  // Probe
  list_ignored_probe_questions: 'Смотрю отложенные вопросы',
  // Умные таблицы (Smart-tables)
  infer_table_schema: 'Определяю структуру таблицы',
  create_table: 'Создаю таблицу',
  add_rows: 'Добавляю строки',
  query_table: 'Читаю таблицу',
};

/**
 * Человекочитаемый лейбл инструмента Concierge по сырому `toolName`.
 * Фолбэк для неизвестного кода — `name.replaceAll('_', ' ')` (без латиницы
 * в скобках, без протечки сырого enum-кода).
 */
export function toolNameLabel(name: string): string {
  return TOOL_NAME_LABEL[name] ?? name.replaceAll('_', ' ');
}
