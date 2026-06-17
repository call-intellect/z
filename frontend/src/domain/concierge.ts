const TOOL_NAME_LABEL: Record<string, string> = {
  list_meetings: "Смотрю встречи",
  create_meeting: "Создаю встречу",
  cancel_meeting: "Отменяю встречу",
  search_knowledge: "Ищу в памяти компании",
  list_tasks: "Смотрю задачи",
  list_overdue_promises: "Смотрю просроченные обещания",
  create_event: "Создаю событие в календаре",
  list_my_events: "Смотрю мои события",
  list_user_events: "Смотрю события сотрудника",
  find_free_slot: "Ищу свободное время",
  delete_event: "Удаляю событие",
  ask_role_clone: "Спрашиваю клон роли",
  list_clones: "Смотрю клоны ролей",
  get_person_pulse: "Смотрю пульс сотрудника",
  get_sprint_status: "Смотрю статус спринта",
  get_team_health: "Смотрю здоровье команды",
  list_ignored_probe_questions: "Смотрю отложенные вопросы",
  infer_table_schema: "Определяю структуру таблицы",
  create_table: "Создаю таблицу",
  add_rows: "Добавляю строки",
  query_table: "Читаю таблицу",
};

export function toolNameLabel(name: string): string {
  return TOOL_NAME_LABEL[name] ?? name.replaceAll("_", " ");
}
