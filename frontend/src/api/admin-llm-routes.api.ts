import { apiClient } from './api-client';

/**
 * API DTO для админ-роутера LLM (admin → AI Models).
 * Контракт — `backend/src/modules/admin/llm-routes/`.
 *
 * Полный список taskType — `ALL_LLM_TASK_TYPES` в backend
 * `llm-router.service.ts`. Backend Zod-схема расширена под все taskType
 * (Фаза 7 шаг 4). Здесь зеркалируем их для UI.
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
  'card-rollup',
  'card-chat',
  'block-ingest',
  'block-distill',
  'block-linker',
  'entity-resolver',
  'entity-merge-arbiter',
  'entity-graph-builder',
  'theme-classify',
  'reframing',
  'card-rollup-v2',
  'task-extract-v2',
  'chapter-extract-v2',
  'summary-v2',
  'chat-v2',
  'goal-alignment',
  'dashboard-summary',
] as const;
export type LlmTaskType = (typeof LLM_TASK_TYPES)[number];

export const LLM_PROVIDERS = [
  'anthropic',
  'minimax',
  'openai-via-proxy',
  'deepseek',
  'ollama',
] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export type LlmRouteProvider = {
  provider: LlmProvider;
  model?: string;
};

export type LlmRouteApi = {
  taskType: string;
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
