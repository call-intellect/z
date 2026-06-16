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

export function resourceTypeRu(t: string): string {
  return RESOURCE_TYPE_RU[t] ?? t;
}

const LEVEL_RU: Record<string, string> = {
  light: 'базовый',
  medium: 'средний',
  high: 'высокий',
};

export function levelRu(level: string): string {
  return LEVEL_RU[level] ?? level;
}

const RESOLUTION_RU: Record<string, string> = {
  accepted: 'принято',
  dismissed: 'отклонено',
  merged: 'объединено',
  superseded: 'заменено',
  kept_existing: 'оставлено прежнее',
  kept_new: 'принято новое',
};

export function resolutionRu(resolution: string | null | undefined): string {
  if (!resolution) return 'отклонено';
  return RESOLUTION_RU[resolution] ?? resolution;
}
