/**
 * Доменная модель A/B-эксперимента LLM (Z-Admin Фаза 7).
 *
 * Контракт: backend `AdminExperimentsService.ExperimentStatus`,
 * `ExperimentMetrics`, `ExperimentCallRow`.
 */

export type AdminExperimentConfigApi = {
  enabled?: boolean;
  modelA?: string;
  modelB?: string;
  splitPercent?: number;
  startedAt?: string;
  endsAt?: string;
};

export type AdminExperimentMetricsApi = {
  totalCalls: number;
  failedCalls: number;
  failRate: number;
  avgCostUsd: number;
  avgDurationMs: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  totalCostUsd: number;
};

export type AdminExperimentCallRowApi = {
  id: string;
  createdAt: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  success: boolean;
  errorText: string | null;
  responsePreview: string | null;
};

export type AdminExperimentStatusApi = {
  taskType: string;
  config: AdminExperimentConfigApi | null;
  metrics: {
    A: AdminExperimentMetricsApi;
    B: AdminExperimentMetricsApi;
  };
  recentCalls: {
    A: AdminExperimentCallRowApi[];
    B: AdminExperimentCallRowApi[];
  };
};

export type AdminExperimentConfigDomain = {
  enabled: boolean;
  modelA: string;
  modelB: string;
  splitPercent: number;
  startedAt: Date | null;
  endsAt: Date | null;
};

export type AdminExperimentCallRowDomain = Omit<
  AdminExperimentCallRowApi,
  'createdAt'
> & {
  createdAt: Date;
};

export type AdminExperimentStatusDomain = {
  taskType: string;
  config: AdminExperimentConfigDomain | null;
  metrics: {
    A: AdminExperimentMetricsApi;
    B: AdminExperimentMetricsApi;
  };
  recentCalls: {
    A: AdminExperimentCallRowDomain[];
    B: AdminExperimentCallRowDomain[];
  };
};

function callRowFromApi(
  api: AdminExperimentCallRowApi,
): AdminExperimentCallRowDomain {
  return { ...api, createdAt: new Date(api.createdAt) };
}

export function adminExperimentStatusFromApi(
  api: AdminExperimentStatusApi,
): AdminExperimentStatusDomain {
  const cfg = api.config;
  return {
    taskType: api.taskType,
    config:
      cfg && cfg.enabled === true
        ? {
            enabled: true,
            modelA: cfg.modelA ?? 'unknown:default',
            modelB: cfg.modelB ?? 'unknown:default',
            splitPercent: cfg.splitPercent ?? 50,
            startedAt: cfg.startedAt ? new Date(cfg.startedAt) : null,
            endsAt: cfg.endsAt ? new Date(cfg.endsAt) : null,
          }
        : null,
    metrics: api.metrics,
    recentCalls: {
      A: api.recentCalls.A.map(callRowFromApi),
      B: api.recentCalls.B.map(callRowFromApi),
    },
  };
}

// ─── Function (taskType) detail ─────────────────────────────────────────────

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
  'lastCallAt'
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
            modelA: cfg.modelA ?? 'unknown:default',
            modelB: cfg.modelB ?? 'unknown:default',
            splitPercent: cfg.splitPercent ?? 50,
            startedAt: cfg.startedAt ? new Date(cfg.startedAt) : null,
            endsAt: cfg.endsAt ? new Date(cfg.endsAt) : null,
          }
        : null,
  };
}

// ─── Lables ─────────────────────────────────────────────────────────────────

/** Расшифровки taskType (для UI). taskType-keys взяты из ALL_LLM_TASK_TYPES. */
export const TASK_TYPE_LABELS: Record<string, string> = {
  summary: 'Summary встречи',
  chapters: 'Главы встречи',
  tasks: 'Задачи из встречи',
  chat: 'Чат по встрече',
  'regenerate-section': 'Регенерация секции',
  'custom-prompt': 'Произвольный промпт',
  'follow-up': 'Follow-up email',
  'clip-title': 'Заголовок клипа',
  'card-rollup': 'Карточка: rollup',
  'card-chat': 'Карточка: чат',
  'block-ingest': 'Блок: извлечение',
  'block-distill': 'Блок: дистилляция',
  'block-linker': 'Блок: связи',
  'entity-resolver': 'Сущности: распознавание',
  'entity-merge-arbiter': 'Сущности: арбитр слияний',
  'entity-graph-builder': 'Сущности: граф',
  'theme-classify': 'Темы: классификация',
  reframing: 'Темы: переформулировка',
  'card-rollup-v2': 'Карточка: rollup v2',
  'chat-v2': 'Чат v2 (knowledge)',
  'goal-alignment': 'Goal alignment',
  'dashboard-summary': 'Дашборд: summary',
};

export function taskTypeLabel(taskType: string): string {
  return TASK_TYPE_LABELS[taskType] ?? taskType;
}
