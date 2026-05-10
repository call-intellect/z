/**
 * API-клиент модуля goals (knowledge-core, Фаза 9).
 *
 * Контракт: `backend/src/modules/goals/goals.controller.ts`.
 * Auth: `CookieAuthGuard + TenantGuard` (cookie + `X-Org-Id` header).
 */

import { apiClient } from './api-client';
import { buildQuery, orgHeaders } from './admin-helpers';
import type {
  GoalDetailApi,
  GoalListApi,
  GoalListItemApi,
  GoalStatus,
} from '@/domain/goal';

export type ListGoalsRequest = {
  /** 'active' | 'paused' | 'achieved' | 'abandoned' | 'all'. По умолчанию backend = 'active'. */
  status?: GoalStatus | 'all';
  limit?: number;
};

export type CreateGoalRequest = {
  name: string;
  description: string;
  targetDate?: string | null;
  weight?: number;
};

export type UpdateGoalRequest = {
  name?: string;
  description?: string;
  targetDate?: string | null;
  weight?: number;
  status?: GoalStatus;
};

export type AddThemesRequest = { themeIds: string[] };

export const goalsApi = {
  list: (orgId: string, req: ListGoalsRequest = {}) =>
    apiClient.get<GoalListApi>(
      `/api/v1/goals${buildQuery({ ...req })}`,
      { headers: orgHeaders(orgId) },
    ),

  get: (orgId: string, goalId: string) =>
    apiClient.get<GoalDetailApi>(
      `/api/v1/goals/${encodeURIComponent(goalId)}`,
      { headers: orgHeaders(orgId) },
    ),

  create: (orgId: string, body: CreateGoalRequest) =>
    apiClient.post<GoalListItemApi>(
      '/api/v1/goals',
      body,
      { headers: orgHeaders(orgId) },
    ),

  update: (orgId: string, goalId: string, body: UpdateGoalRequest) =>
    apiClient.patch<GoalListItemApi>(
      `/api/v1/goals/${encodeURIComponent(goalId)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  archive: (orgId: string, goalId: string) =>
    apiClient.del<{ id: string; archivedAt: string }>(
      `/api/v1/goals/${encodeURIComponent(goalId)}`,
      { headers: orgHeaders(orgId) },
    ),

  addThemes: (orgId: string, goalId: string, body: AddThemesRequest) =>
    apiClient.post<{ added: number; skipped: number }>(
      `/api/v1/goals/${encodeURIComponent(goalId)}/themes`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  removeTheme: (orgId: string, goalId: string, themeId: string) =>
    apiClient.del<{ removed: boolean }>(
      `/api/v1/goals/${encodeURIComponent(goalId)}/themes/${encodeURIComponent(themeId)}`,
      { headers: orgHeaders(orgId) },
    ),

  recompute: (orgId: string, goalId: string) =>
    apiClient.post<{ enqueued: true; jobId: string }>(
      `/api/v1/goals/${encodeURIComponent(goalId)}/recompute`,
      undefined,
      { headers: orgHeaders(orgId) },
    ),
};
