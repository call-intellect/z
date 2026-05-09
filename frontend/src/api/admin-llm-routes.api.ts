import { apiClient } from './api-client';

/**
 * API DTO для админ-роутера LLM (admin → AI Models).
 * Контракт — `backend/src/modules/admin/llm-routes/`.
 */

export const LLM_TASK_TYPES = [
  'summary',
  'chapters',
  'tasks',
  'chat',
  'regenerate-section',
  'custom-prompt',
  'follow-up',
  'clip-title',
] as const;
export type LlmTaskType = (typeof LLM_TASK_TYPES)[number];

export const LLM_PROVIDERS = ['anthropic', 'minimax', 'openai-via-proxy'] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export type LlmRouteProvider = {
  provider: LlmProvider;
  model?: string;
};

export type LlmRouteApi = {
  taskType: LlmTaskType;
  providers: LlmRouteProvider[];
  isActive: boolean;
  updatedAt?: string;
};

export type LlmRoutesListApiResponse = {
  items: LlmRouteApi[];
};

export type PutLlmRouteRequest = {
  providers: LlmRouteProvider[];
  isActive: boolean;
};

export const adminLlmRoutesApi = {
  list: () =>
    apiClient.get<LlmRoutesListApiResponse>('/api/v1/admin/llm-routes'),

  upsert: (taskType: LlmTaskType, body: PutLlmRouteRequest) =>
    apiClient.put<LlmRouteApi>(
      `/api/v1/admin/llm-routes/${encodeURIComponent(taskType)}`,
      body,
    ),
};
