/** RU-названия типов ресурсов для отображения (НЕ для value фильтров). */
const RESOURCE_TYPE_RU: Record<string, string> = {
  idea_block: 'карточка знания',
  entity: 'сущность',
  entity_link: 'связь сущностей',
  regulation: 'регламент',
  process: 'процесс',
  policy: 'политика',
  decision: 'решение',
  fact: 'факт',
  note: 'заметка',
  card: 'карточка',
  insight: 'инсайт',
  idea: 'идея',
  cycle: 'цикл',
  experiment: 'эксперимент',
  intake_issue: 'обращение',
  knowledge_profile: 'профиль знаний',
  probe_question: 'уточняющий вопрос',
  skill_trait: 'навык',
  role: 'должность',
  company_profile: 'профиль компании',
};
export const RESOURCE_TYPE_RU_KEYS = Object.keys(RESOURCE_TYPE_RU);
/** Переводит тип ресурса в RU для отображения; неизвестный — как есть. */
export function resourceTypeRu(t: string): string {
  return RESOURCE_TYPE_RU[t] ?? t;
}
