/**
 * API-клиент модуля tracker.cycles.
 *
 * Контракт: `backend/src/modules/tracker/controllers/cycles.controller.ts`.
 */

import { apiClient } from '../api-client';
import { orgHeaders } from '../admin-helpers';
import type {
  CompleteCycleResultApi,
  CycleApi,
  ListCyclesResponseApi,
  ListIssuesResponseApi,
} from '@/domain/tracker';

export interface CreateCycleRequest {
  name: string;
  startDate: string;
  endDate: string;
  ownedById?: string | null;
  description?: string | null;
  timezone?: string;
}

export interface UpdateCycleRequest {
  name?: string;
  startDate?: string;
  endDate?: string;
  ownedById?: string | null;
  description?: string | null;
  timezone?: string;
  /** Goals OKR v2 — цель, которую продвигает спринт (null = отвязать). */
  primaryGoalId?: string | null;
}

export const cyclesApi = {
  list: (orgId: string, projectId: string) =>
    apiClient.get<ListCyclesResponseApi>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/cycles`,
      { headers: orgHeaders(orgId) },
    ),

  create: (orgId: string, projectId: string, body: CreateCycleRequest) =>
    apiClient.post<CycleApi>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/cycles`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  get: (orgId: string, cycleId: string) =>
    apiClient.get<CycleApi>(`/api/v1/cycles/${encodeURIComponent(cycleId)}`, {
      headers: orgHeaders(orgId),
    }),

  update: (orgId: string, cycleId: string, body: UpdateCycleRequest) =>
    apiClient.patch<CycleApi>(
      `/api/v1/cycles/${encodeURIComponent(cycleId)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  complete: (orgId: string, cycleId: string) =>
    apiClient.post<CompleteCycleResultApi>(
      `/api/v1/cycles/${encodeURIComponent(cycleId)}/complete`,
      undefined,
      { headers: orgHeaders(orgId) },
    ),

  issues: (orgId: string, cycleId: string) =>
    apiClient.get<ListIssuesResponseApi>(
      `/api/v1/cycles/${encodeURIComponent(cycleId)}/issues`,
      { headers: orgHeaders(orgId) },
    ),
};
