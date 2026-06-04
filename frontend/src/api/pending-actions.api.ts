/**
 * API-клиент Action Center — pending-подтверждения пользователя.
 *
 * Контракт (Фаза B0, backend): `backend/src/modules/pending-actions/*`.
 *   - GET  /api/v1/pending-actions/count
 *   - GET  /api/v1/pending-actions?limit=50
 *   - POST /api/v1/pending-actions/snooze
 *   - POST /api/v1/pending-actions/confirm  (B4 — быстрый путь подтверждения)
 *
 * Все запросы org-scoped — заголовок `X-Org-Id` через `orgHeaders(orgId)`.
 */

import { apiClient } from './api-client';
import { buildQuery, orgHeaders } from './admin-helpers';

export type PendingActionSourceApi =
  | 'curation'
  | 'conflict'
  | 'intake'
  | 'probe';

export type PendingActionSeverityApi = 'normal' | 'urgent';

export interface PendingActionsCountApi {
  total: number;
  bySource: {
    curation: number;
    conflict: number;
    intake: number;
    probe: number;
  };
}

export interface PendingActionItemApi {
  source: PendingActionSourceApi;
  resourceType: string;
  resourceId: string;
  title: string;
  severity: PendingActionSeverityApi;
  ageDays: number;
  actionUrl: string;
  canQuickConfirm: boolean;
}

export interface PendingActionsListApi {
  items: PendingActionItemApi[];
}

export interface SnoozePendingActionRequest {
  source: PendingActionSourceApi;
  resourceType: string;
  resourceId: string;
  /** Через сколько часов снова показать (1..720). */
  hours: number;
}

/**
 * Action Center B4 — быстрое подтверждение item'а (one-tap approve).
 * Поддерживается только `source==='curation'` для light-уровня
 * (`canQuickConfirm===true`).
 */
export interface ConfirmPendingActionRequest {
  source: PendingActionSourceApi;
  resourceId: string;
}

export const pendingActionsApi = {
  count: (orgId: string) =>
    apiClient.get<PendingActionsCountApi>('/api/v1/pending-actions/count', {
      headers: orgHeaders(orgId),
    }),

  list: (orgId: string, limit = 50) =>
    apiClient.get<PendingActionsListApi>(
      `/api/v1/pending-actions${buildQuery({ limit })}`,
      { headers: orgHeaders(orgId) },
    ),

  snooze: (orgId: string, body: SnoozePendingActionRequest) =>
    apiClient.post<void>('/api/v1/pending-actions/snooze', body, {
      headers: orgHeaders(orgId),
    }),

  confirm: (orgId: string, body: ConfirmPendingActionRequest) =>
    apiClient.post<{ ok: true }>('/api/v1/pending-actions/confirm', body, {
      headers: orgHeaders(orgId),
    }),
};
