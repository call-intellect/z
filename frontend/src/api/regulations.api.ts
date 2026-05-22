/**
 * API-клиент модуля regulations (SBA α-7).
 * Контракт: `backend/src/modules/regulations/`.
 *
 * Эндпоинты:
 *   - GET  /api/v1/regulations?kind=&status=&scope=&q=&page=&limit=
 *   - GET  /api/v1/regulations/:id?kind=
 *   - GET  /api/v1/regulations/:id/history?kind=
 *   - POST /api/v1/regulations/:id/supersede   (admin/owner)
 *   - POST /api/v1/regulations/:id/confirm     (admin/owner)
 *
 * Защита: `CookieAuthGuard + TenantGuard`, RBAC `regulation:read|write` /
 * `process:read|write` / `policy:read|write`.
 */

import { apiClient } from './api-client';

export type RegulationKindApi = 'regulation' | 'process' | 'policy' | 'standard';

export type RegulationStatusApi = 'active' | 'deprecated' | 'archived';

export type PolicySeverityApi = 'advisory' | 'mandatory' | 'blocking';

export interface RegulationListItemApi {
  id: string;
  kind: RegulationKindApi;
  name: string;
  statement: string | null;
  category: 'regulation' | 'standard' | null;
  severity: PolicySeverityApi | null;
  scope: string | null;
  status: RegulationStatusApi;
  ownerPersonId: string | null;
  confidence: number | null;
  lastConfirmedAt: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface ProcessStepApi {
  id: string;
  order: number;
  name: string;
  description: string | null;
  slaMinutes: number | null;
}

export interface RegulationDetailApi extends RegulationListItemApi {
  contentMd: string;
  sourceBlockIds: string[];
  personSubjectIds: string[];
  currentVersionId: string | null;
  steps?: ProcessStepApi[];
  supersedesId?: string | null;
}

export interface RegulationsListResponseApi {
  items: RegulationListItemApi[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface RegulationVersionItemApi {
  id: string;
  version: number;
  previousVersionId: string | null;
  payload: Record<string, unknown>;
  changeReason: string | null;
  createdAt: string;
  createdByUserId: string | null;
}

export interface RegulationHistoryResponseApi {
  items: RegulationVersionItemApi[];
}

export type ListRegulationsRequest = {
  page?: number;
  limit?: number;
  kind?: RegulationKindApi;
  status?: RegulationStatusApi;
  scope?: string;
  q?: string;
};

function buildRegulationsQuery(filters?: ListRegulationsRequest): string {
  if (!filters) return '';
  const p = new URLSearchParams();
  if (filters.page) p.set('page', String(filters.page));
  if (filters.limit) p.set('limit', String(filters.limit));
  if (filters.kind) p.set('kind', filters.kind);
  if (filters.status) p.set('status', filters.status);
  if (filters.scope) p.set('scope', filters.scope);
  if (filters.q) p.set('q', filters.q);
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}

export const regulationsApi = {
  list: (filters?: ListRegulationsRequest) =>
    apiClient.get<RegulationsListResponseApi>(
      `/api/v1/regulations${buildRegulationsQuery(filters)}`,
    ),

  get: (id: string, kind: RegulationKindApi) =>
    apiClient.get<RegulationDetailApi>(
      `/api/v1/regulations/${encodeURIComponent(id)}?kind=${encodeURIComponent(kind)}`,
    ),

  history: (id: string, kind: RegulationKindApi) =>
    apiClient.get<RegulationHistoryResponseApi>(
      `/api/v1/regulations/${encodeURIComponent(id)}/history?kind=${encodeURIComponent(kind)}`,
    ),

  supersede: (id: string, body: { kind: RegulationKindApi; supersededByRegulationId: string }) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/regulations/${encodeURIComponent(id)}/supersede`,
      body,
    ),

  confirm: (id: string, body: { kind: RegulationKindApi }) =>
    apiClient.post<{ ok: true; lastConfirmedAt: string }>(
      `/api/v1/regulations/${encodeURIComponent(id)}/confirm`,
      body,
    ),
};
