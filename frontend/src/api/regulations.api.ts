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
 *   - POST /api/v1/regulations/:id/dispute     («это неверно» — любой участник)
 *   - POST /api/v1/regulations/:id/correct     («исправить» — owner/admin применяют сразу)
 *
 * Защита: `CookieAuthGuard + TenantGuard`, RBAC `regulation:read|write` /
 * `process:read|write` / `policy:read|write`.
 */

import { apiClient } from './api-client';

export type RegulationKindApi =
  | 'regulation'
  | 'process'
  | 'policy'
  | 'standard'
  | 'instruction';

export type RegulationStatusApi = 'active' | 'deprecated' | 'archived';

export type PolicySeverityApi = 'advisory' | 'mandatory' | 'blocking';

export type TrustTierApi = 'auto' | 'provisional' | 'human';

/**
 * Статус извлечения сущности (Фронт B2.2).
 *   - `exists`    — извлечено, сущность реально существует;
 *   - `needed`    — нужно создать/доформулировать (черновик);
 *   - `discussed` — пока только обсуждается.
 *
 * Поле опционально: если бэк его ещё не присылает — чип не показываем.
 */
export type ExtractionStatusApi = 'exists' | 'needed' | 'discussed';

/** Источник изменения версии (Фронт B2.5). Опционально. */
export type RegulationChangeSourceApi = 'agent' | 'manual' | 'imported';

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
  trustTier: TrustTierApi;
  /**
   * Статус извлечения (B2.2). Опционально — бэк может ещё не присылать.
   * Если ∈ {needed, discussed} — запись считается черновиком/обсуждаемой,
   * lifecycle «Действует» для неё не показывается (B2.3).
   */
  extractionStatus?: ExtractionStatusApi | null;
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
  /**
   * Причина/заметка изменения процесса (B2.5). Для process бэк хранит её
   * под именем `changeNote` — UI показывает оба под одним лейблом.
   * Опционально.
   */
  changeNote?: string | null;
  /** Источник изменения (B2.5). Опционально. */
  source?: RegulationChangeSourceApi | null;
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

  dispute: (id: string, body: { kind: RegulationKindApi; reason?: string }) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/regulations/${encodeURIComponent(id)}/dispute`,
      body,
    ),

  correct: (
    id: string,
    body: {
      kind: RegulationKindApi;
      correctedPayload: {
        name?: string;
        contentMd?: string;
        statement?: string;
        description?: string;
      };
      reason?: string;
    },
  ) =>
    apiClient.post<{ ok: true; applied: boolean }>(
      `/api/v1/regulations/${encodeURIComponent(id)}/correct`,
      body,
    ),
};
