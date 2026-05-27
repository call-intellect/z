/**
 * API-клиент модуля «Спринты» (master-detail список и quick-create).
 *
 * Контракт: `backend/src/modules/tracker/controllers/sprints.controller.ts`
 *   - GET  /api/v1/sprints              — список спринтов c фильтрами
 *   - POST /api/v1/sprints/quick-create — атомарное создание Project+Cycle
 *
 * Auth: `CookieAuthGuard + TenantGuard` (cookie + `X-Org-Id`).
 *
 * Сосуществует с `frontend/src/api/tracker/sprints.api.ts` (там — дашборд /
 * отчёт / стартовая встреча по конкретному cycleId). Здесь только endpoint'ы
 * списка и создания, поэтому экспортируем под другим именем `sprintsListApi`.
 */
import { apiClient } from './api-client';
import { buildQuery, orgHeaders } from './admin-helpers';
import type { SprintScopeKindApi } from '@/domain/sprint';

export type SprintStatusFilterApi =
  | 'active'
  | 'completed'
  | 'upcoming'
  | 'all';

export type SprintSortByApi = 'startDate' | 'progress' | 'hints';
export type SprintSortDirApi = 'asc' | 'desc';

export interface ListSprintsRequest {
  status?: SprintStatusFilterApi;
  scopeKind?: SprintScopeKindApi;
  q?: string;
  sortBy?: SprintSortByApi;
  sortDir?: SprintSortDirApi;
  page?: number;
  limit?: number;
}

export interface SprintListItemApi {
  id: string;
  projectId: string;
  name: string;
  project: { id: string; name: string; identifier: string };
  scope: {
    kind: SprintScopeKindApi;
    label: string;
    refId: string | null;
    isDeleted: boolean;
  };
  startDate: string;
  endDate: string;
  status: 'active' | 'completed' | 'upcoming';
  progress: {
    total: number;
    completed: number;
    ratio: number;
  };
  activeHintsCount: number;
  criticalHintsCount: number;
  linkedMeetingsCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ListSprintsResponseApi {
  items: SprintListItemApi[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface QuickCreateSprintRequest {
  scope: SprintScopeKindApi;
  refId?: string | null;
  existingProjectId?: string | null;
  sprintName: string;
  durationDays: 7 | 14 | 21 | 28;
  startDate: string;
  timezone?: string;
}

export interface QuickCreateSprintResponseApi {
  cycleId: string;
  projectId: string;
  projectIdentifier: string;
  projectSlug: string;
}

export const sprintsListApi = {
  list: (orgId: string, req: ListSprintsRequest = {}) =>
    apiClient.get<ListSprintsResponseApi>(
      `/api/v1/sprints${buildQuery({
        status: req.status,
        scopeKind: req.scopeKind,
        q: req.q,
        sortBy: req.sortBy,
        sortDir: req.sortDir,
        page: req.page,
        limit: req.limit,
      })}`,
      { headers: orgHeaders(orgId) },
    ),

  quickCreate: (orgId: string, body: QuickCreateSprintRequest) =>
    apiClient.post<QuickCreateSprintResponseApi>(
      '/api/v1/sprints/quick-create',
      body,
      { headers: orgHeaders(orgId) },
    ),
};
