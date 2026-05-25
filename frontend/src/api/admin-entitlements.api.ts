/**
 * API-клиент для глобального обзора OrgEntitlement — Z-Admin Фаза 4.
 *
 * Контракт сервера: `backend/src/modules/admin/entitlements/entitlements.controller.ts`
 * (префикс `/api/v1/admin/orgs`).
 */

import { apiClient } from './api-client';
import { buildQuery } from './admin-helpers';
import type {
  EntitlementOverviewApi,
  ResolvedEntitlementsApi,
  UpsertEntitlementRequest,
} from '@/domain/admin-entitlement';

export type ListEntitlementsRequest = {
  /** По умолчанию `true` — только Org с override'ами. */
  hasOverrides?: boolean;
  /** Опц. фильтр по конкретному tier. */
  plan?: string;
  cursor?: string;
  limit?: number;
};

export const adminEntitlementsApi = {
  listOverview: (req: ListEntitlementsRequest = {}) =>
    apiClient.get<EntitlementOverviewApi>(
      `/api/v1/admin/orgs/entitlements${buildQuery({ ...req })}`,
    ),

  upsert: (orgId: string, body: UpsertEntitlementRequest) =>
    apiClient.patch<{ ok: true; tenantId: string; tier: string }>(
      `/api/v1/admin/orgs/${encodeURIComponent(orgId)}/entitlements`,
      body,
    ),

  removeFeatureKey: (orgId: string, featureKey: string) =>
    apiClient.del<{ ok: true; removed: boolean }>(
      `/api/v1/admin/orgs/${encodeURIComponent(orgId)}/entitlements/feature/${encodeURIComponent(featureKey)}`,
    ),

  removeQuotaKey: (orgId: string, quotaKey: string) =>
    apiClient.del<{ ok: true; removed: boolean }>(
      `/api/v1/admin/orgs/${encodeURIComponent(orgId)}/entitlements/quota/${encodeURIComponent(quotaKey)}`,
    ),

  resolve: (orgId: string) =>
    apiClient.post<ResolvedEntitlementsApi>(
      `/api/v1/admin/orgs/${encodeURIComponent(orgId)}/entitlements/resolve`,
      {},
    ),
};
