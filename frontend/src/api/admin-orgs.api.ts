/**
 * API-клиент для управления Org (Z-Admin Фаза 7).
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
};
