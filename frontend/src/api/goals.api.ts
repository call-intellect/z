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
  GoalHorizon,
  GoalKeyResultApi,
  GoalKrSourceKind,
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
  /** ТЗ-F — ответственный (Person.id). Опустить/null = без ответственного. */
  ownerPersonId?: string | null;
};

export type UpdateGoalRequest = {
  name?: string;
  description?: string;
  targetDate?: string | null;
  weight?: number;
  status?: GoalStatus;
  /** Goals OKR v2 — перепривязка в дереве (null = открепить от родителя). */
  parentGoalId?: string | null;
  horizon?: GoalHorizon;
  progressStatus?: string;
  promotionState?: 'suggested' | 'active' | 'dismissed';
  /** ТЗ-F — ответственный (Person.id). null = снять ответственного. */
  ownerPersonId?: string | null;
};

export type AddThemesRequest = { themeIds: string[] };

/** Goals OKR v2 — создание измеримого ориентира (Key Result). */
export type CreateKeyResultRequest = {
  name: string;
  unit?: string | null;
  startValue: number;
  targetValue: number;
  currentValue?: number;
  sourceKind?: GoalKrSourceKind;
  sourceConfig?: Record<string, unknown>;
};

/** Goals OKR v2 — частичное обновление KR (≥1 поле). */
export type UpdateKeyResultRequest = {
  name?: string;
  unit?: string | null;
  startValue?: number;
  targetValue?: number;
  currentValue?: number;
  sourceKind?: GoalKrSourceKind;
  sourceConfig?: Record<string, unknown>;
};

/** Goals OKR v2 — «передумали»: создать новую версию цели (все поля опц.). */
export type SupersedeGoalRequest = {
  name?: string;
  description?: string;
  targetDate?: string | null;
  horizon?: GoalHorizon;
  weight?: number;
};

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

  // ── Goals OKR v2 — Key Results ──
  createKeyResult: (orgId: string, goalId: string, body: CreateKeyResultRequest) =>
    apiClient.post<GoalKeyResultApi>(
      `/api/v1/goals/${encodeURIComponent(goalId)}/key-results`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  updateKeyResult: (
    orgId: string,
    goalId: string,
    krId: string,
    body: UpdateKeyResultRequest,
  ) =>
    apiClient.patch<GoalKeyResultApi>(
      `/api/v1/goals/${encodeURIComponent(goalId)}/key-results/${encodeURIComponent(krId)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  removeKeyResult: (orgId: string, goalId: string, krId: string) =>
    apiClient.del<{ removed: boolean }>(
      `/api/v1/goals/${encodeURIComponent(goalId)}/key-results/${encodeURIComponent(krId)}`,
      { headers: orgHeaders(orgId) },
    ),

  // ── Goals OKR v2 — supersede («передумали») ──
  supersede: (orgId: string, goalId: string, body: SupersedeGoalRequest) =>
    apiClient.post<GoalDetailApi>(
      `/api/v1/goals/${encodeURIComponent(goalId)}/supersede`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  // ── ТЗ-2 Ф6.A — MoSCoW-приоритет цели (owner/admin only) ──
  /**
   * `PATCH /api/v1/goals/:id/priority` — задать/снять MoSCoW-приоритет цели.
   * `priority=null` снимает приоритет. Доступ: owner/admin.
   */
  setPriority: (
    orgId: string,
    goalId: string,
    priority: 'must' | 'should' | 'could' | 'wont' | null,
  ) =>
    apiClient.patch<{ id: string; priority: 'must' | 'should' | 'could' | 'wont' | null }>(
      `/api/v1/goals/${encodeURIComponent(goalId)}/priority`,
      { priority },
      { headers: orgHeaders(orgId) },
    ),
};
