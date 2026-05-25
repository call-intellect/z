/**
 * API-клиент для управления Org (Z-Admin Фаза 7 + Фаза 4 редизайна).
 *
 * Контракт: `backend/src/modules/admin/controllers/admin-orgs.controller.ts`.
 */

import { apiClient } from './api-client';
import { buildQuery } from './admin-helpers';
import type { AdminOrgListApi, UpdateOrgRequest } from '@/domain/admin-org';
import type { AdminPeriod } from '@/domain/admin-usage';

export type ListOrgsRequest = {
  period?: AdminPeriod;
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
  cursor?: string;
  includeDeleted?: boolean;
};

/** Admin-redesign Фаза 4 — глобальная карточка `/admin/orgs/[id]`. */

export type OrgOverviewApi = {
  id: string;
  name: string;
  slug: string;
  tier: 'basic' | 'pro' | 'enterprise';
  createdAt: string;
  ownerEmail: string | null;
  membersCount: number;
  meetingsCount: number;
  totalSpendUsd: number;
  totalRevenueRub: number | null;
  isFrozen: boolean;
};

export type OrgMemberItemApi = {
  userId: string;
  email: string | null;
  name: string;
  role: string;
  joinedAt: string;
  lastSeenAt: string | null;
};

export type OrgMembersApi = {
  items: OrgMemberItemApi[];
  nextCursor: string | null;
};

export type OrgSourceItemApi = {
  kind: string;
  type: string;
  id: string;
  status: string;
  createdAt: string;
};

export type OrgSourcesApi = { items: OrgSourceItemApi[] };

export type OrgAuditItemApi = {
  id: string;
  superAdminUserId: string;
  superAdminEmail: string | null;
  route: string;
  method: string;
  reason: string | null;
  createdAt: string;
};

export type OrgAuditApi = {
  items: OrgAuditItemApi[];
  nextCursor: string | null;
};

export type CursorPaginationRequest = {
  cursor?: string;
  limit?: number;
};

export const adminOrgsApi = {
  list: (req: ListOrgsRequest = {}) =>
    apiClient.get<AdminOrgListApi>(
      `/api/v1/admin/orgs${buildQuery({ ...req })}`,
    ),

  update: (orgId: string, body: UpdateOrgRequest) =>
    apiClient.patch<{ ok: true }>(
      `/api/v1/admin/orgs/${encodeURIComponent(orgId)}`,
      body,
    ),

  remove: (orgId: string) =>
    apiClient.del<{ ok: true }>(
      `/api/v1/admin/orgs/${encodeURIComponent(orgId)}`,
    ),

  overview: (orgId: string) =>
    apiClient.get<OrgOverviewApi>(
      `/api/v1/admin/orgs/${encodeURIComponent(orgId)}/overview`,
    ),

  members: (orgId: string, req: CursorPaginationRequest = {}) =>
    apiClient.get<OrgMembersApi>(
      `/api/v1/admin/orgs/${encodeURIComponent(orgId)}/members${buildQuery({ ...req })}`,
    ),

  sources: (orgId: string) =>
    apiClient.get<OrgSourcesApi>(
      `/api/v1/admin/orgs/${encodeURIComponent(orgId)}/sources`,
    ),

  audit: (orgId: string, req: CursorPaginationRequest = {}) =>
    apiClient.get<OrgAuditApi>(
      `/api/v1/admin/orgs/${encodeURIComponent(orgId)}/audit${buildQuery({ ...req })}`,
    ),
};
