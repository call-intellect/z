/**
 * W2.3 KC-Temporal (2026-05-25) — DomainModel для LlmPreferenceSample.
 *
 * Источник данных: `backend/src/modules/admin/llm-preference-dataset/
 * llm-preference-dataset.controller.ts` — endpoints `GET /items` и `GET /stats`.
 */

export type AdminPreferenceLabelApi = 'correct' | 'wrong' | 'misleading';

export type AdminPreferenceSampleApi = {
  id: string;
  tenantId: string;
  taskType: string;
  inputContext: unknown;
  modelOutput: unknown;
  label: string;
  reason: string | null;
  recordedBy: string | null;
  decisionId: string | null;
  createdAt: string;
};

export type AdminPreferenceSampleListApi = {
  items: AdminPreferenceSampleApi[];
};

export type AdminPreferenceStatsApi = {
  total: number;
  byLabel: Record<string, number>;
  byTaskType: Array<{
    taskType: string;
    correct: number;
    wrong: number;
    misleading: number;
    total: number;
  }>;
};

export type AdminPreferenceSampleDomain = {
  id: string;
  tenantId: string;
  taskType: string;
  inputContext: unknown;
  modelOutput: unknown;
  label: AdminPreferenceLabelApi | string;
  reason: string | null;
  recordedBy: string | null;
  decisionId: string | null;
  createdAt: Date;
};

export function adminPreferenceSampleFromApi(
  api: AdminPreferenceSampleApi,
): AdminPreferenceSampleDomain {
  return {
    id: api.id,
    tenantId: api.tenantId,
    taskType: api.taskType,
    inputContext: api.inputContext,
    modelOutput: api.modelOutput,
    label: api.label,
    reason: api.reason,
    recordedBy: api.recordedBy,
    decisionId: api.decisionId,
    createdAt: new Date(api.createdAt),
  };
}
