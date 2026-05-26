/**
 * API-клиент Z-Admin раздела «Управление доступом к клонам» (ТЗ 2026-05-26,
 * волна 3B `clones-marketplace-frontend`).
 *
 * Контракт: `backend/src/modules/clones/clones-admin.controller.ts` + DTO
 * в `clone-access-grant.dto.ts`. Защита бэка — `OrgAdminGuard + TenantGuard`,
 * поэтому все вызовы пробрасывают `X-Org-Id`.
 *
 *   GET    /api/v1/admin/clones/access-grants                       — list с фильтрами.
 *   POST   /api/v1/admin/clones/access-grants                       — выдать грант.
 *   DELETE /api/v1/admin/clones/access-grants/:id                   — soft-revoke.
 *   PATCH  /api/v1/admin/clones/access-grants/:id                   — продлить / снять срок.
 *   GET    /api/v1/admin/clones/:cloneType/:cloneRefId/access-grants — per-clone view.
 *
 * Особенности:
 *   - DTO повторяют backend как есть; даты приходят ISO-строками. Мапперы
 *     в Date — в `frontend/src/domain/admin-clone-access-grant.ts`.
 *   - `expiresAt: null` означает «бессрочно». UI хранит null как «без срока».
 */

import { apiClient } from './api-client';
import { buildQuery, orgHeaders } from './admin-helpers';

// ─────────────── общие типы (зеркало backend DTO) ───────────────

export type CloneTypeApi = 'person' | 'role';

export interface AccessGrantUserSummaryApi {
  userId: string;
  userName: string;
  userEmail?: string;
}

export interface AccessGrantApi {
  id: string;
  cloneType: CloneTypeApi;
  cloneRefId: string;
  /** «Клон Маркетолога v3» или Person.name (для person-грантов). */
  cloneLabel: string;
  grantedTo: AccessGrantUserSummaryApi;
  grantedBy: AccessGrantUserSummaryApi;
  grantedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedBy: AccessGrantUserSummaryApi | null;
  isActive: boolean;
  inactiveReason: 'revoked' | 'expired' | null;
}

export interface AccessGrantListResponseApi {
  items: AccessGrantApi[];
  total: number;
  page: number;
  pageSize: number;
}

// ─────────────── request-параметры ───────────────

export interface ListAccessGrantsRequest {
  grantedToUserId?: string;
  grantedById?: string;
  cloneType?: CloneTypeApi;
  cloneRefId?: string;
  /**
   * true → только активные (revokedAt=NULL и не expired);
   * false → revoked ИЛИ expired;
   * undefined → не фильтруем.
   */
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}

export interface CreateAccessGrantBody {
  grantedToUserId: string;
  cloneType: CloneTypeApi;
  cloneRefId: string;
  /** ISO-строка истечения, null — бессрочно. */
  expiresAt?: string | null;
}

export interface UpdateAccessGrantBody {
  /** ISO-строка нового срока истечения; null — снять срок (бессрочно). */
  expiresAt: string | null;
}

export interface ListAccessGrantsByCloneRequest {
  includeInactive?: boolean;
}

// ─────────────── клиент ───────────────

export const adminClonesApi = {
  /** §2.1 — список грантов с фильтрами и pagination. */
  listAccessGrants: (orgId: string, req: ListAccessGrantsRequest = {}) =>
    apiClient.get<AccessGrantListResponseApi>(
      `/api/v1/admin/clones/access-grants${buildQuery({ ...req })}`,
      { headers: orgHeaders(orgId) },
    ),

  /** §2.2 — выдать грант. */
  createAccessGrant: (orgId: string, body: CreateAccessGrantBody) =>
    apiClient.post<AccessGrantApi>(
      `/api/v1/admin/clones/access-grants`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  /** §2.3 — soft-revoke. */
  revokeAccessGrant: (orgId: string, id: string) =>
    apiClient.del<AccessGrantApi>(
      `/api/v1/admin/clones/access-grants/${encodeURIComponent(id)}`,
      { headers: orgHeaders(orgId) },
    ),

  /** §2.4 — продлить / поменять / снять срок. */
  extendAccessGrant: (
    orgId: string,
    id: string,
    body: UpdateAccessGrantBody,
  ) =>
    apiClient.patch<AccessGrantApi>(
      `/api/v1/admin/clones/access-grants/${encodeURIComponent(id)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  /** §2.5 — все гранты на конкретного клона. */
  listAccessGrantsByClone: (
    orgId: string,
    cloneType: CloneTypeApi,
    cloneRefId: string,
    req: ListAccessGrantsByCloneRequest = {},
  ) =>
    apiClient.get<AccessGrantListResponseApi>(
      `/api/v1/admin/clones/${encodeURIComponent(cloneType)}/${encodeURIComponent(cloneRefId)}/access-grants${buildQuery({ ...req })}`,
      { headers: orgHeaders(orgId) },
    ),
};
