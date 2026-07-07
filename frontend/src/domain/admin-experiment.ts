export type AdminExperimentConfigApi = {
  enabled?: boolean;
  modelA?: string;
  modelB?: string;
  splitPercent?: number;
  startedAt?: string;
  endsAt?: string;
};

export type AdminExperimentConfigDomain = {
  enabled: boolean;
  modelA: string;
  modelB: string;
  splitPercent: number;
  startedAt: Date | null;
  endsAt: Date | null;
};

export type AdminFunctionListItemApi = {
  taskType: string;
  hasRoute: boolean;
  isActive: boolean;
  providers: Array<{ provider: string; model?: string }>;
  experimentEnabled: boolean;
  lastCallAt: string | null;
  lastModel: string | null;
  totalCalls7d: number;
};

export type AdminFunctionListApi = {
  items: AdminFunctionListItemApi[];
};

export type AdminFunctionListItemDomain = Omit<
  AdminFunctionListItemApi,
  "lastCallAt"
> & {
  lastCallAt: Date | null;
};

export type AdminFunctionListDomain = {
  items: AdminFunctionListItemDomain[];
};

export function adminFunctionListFromApi(
  api: AdminFunctionListApi,
): AdminFunctionListDomain {
  return {
    items: api.items.map((it) => ({
      ...it,
      lastCallAt: it.lastCallAt ? new Date(it.lastCallAt) : null,
    })),
  };
}

export type AdminFunctionDetailApi = AdminFunctionListItemApi & {
  experiment: AdminExperimentConfigApi | null;
};

export type AdminFunctionDetailDomain = AdminFunctionListItemDomain & {
  experiment: AdminExperimentConfigDomain | null;
};

export function adminFunctionDetailFromApi(
  api: AdminFunctionDetailApi,
): AdminFunctionDetailDomain {
  const cfg = api.experiment;
  return {
    ...api,
    lastCallAt: api.lastCallAt ? new Date(api.lastCallAt) : null,
    experiment:
      cfg && cfg.enabled === true
        ? {
            enabled: true,
            modelA: cfg.modelA ?? "unknown:default",
            modelB: cfg.modelB ?? "unknown:default",
            splitPercent: cfg.splitPercent ?? 50,
            startedAt: cfg.startedAt ? new Date(cfg.startedAt) : null,
            endsAt: cfg.endsAt ? new Date(cfg.endsAt) : null,
          }
        : null,
  };
}

export const TASK_TYPE_LABELS: Record<string, string> = {
  summary: "Summary встречи",
  chapters: "Главы встречи",
  tasks: "Задачи из встречи",
  chat: "Чат по встрече",
  "regenerate-section": "Регенерация секции",
  "custom-prompt": "Произвольный промпт",
  "follow-up": "Follow-up email",
  "clip-title": "Заголовок клипа",
  "card-rollup": "Карточка: rollup",
  "card-chat": "Карточка: чат",
  "block-ingest": "Блок: извлечение",
  "block-distill": "Блок: дистилляция",
  "block-linker": "Блок: связи",
  "entity-resolver": "Сущности: распознавание",
  "entity-merge-arbiter": "Сущности: арбитр слияний",
  "entity-graph-builder": "Сущности: граф",
  "theme-classify": "Темы: классификация",
  reframing: "Темы: переформулировка",
  "card-rollup-v2": "Карточка: rollup v2",
  "chat-v2": "Чат v2 (knowledge)",
  "goal-alignment": "Goal alignment",
  "dashboard-summary": "Дашборд: summary",
  "company-summary-compile": "Компания: авто-summary",
  "executable-persona-compile": "Клон: сборка персоны",
  "issue-progress-draft": "Трекер: черновик прогресса",
  "probe-formulate": "Probe: формулировка вопроса",
  "probe-quality-judge": "Probe: судья качества",
  "probe-value-gate": "Probe: гейт ценности",
  "sprint-helper-suggest": "Трекер: подсказки спринта",
  "team-health-analyzer": "Здоровье команды: анализ",
};

export function taskTypeLabel(taskType: string): string {
  return TASK_TYPE_LABELS[taskType] ?? taskType;
}
