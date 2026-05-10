/**
 * API-клиент Entitlements (Фаза 12 knowledge-core).
 *
 * Контракт: `backend/src/modules/entitlements/entitlements.controller.ts`.
 *
 * Routes:
 *   - GET   /api/v1/me/entitlements                          — текущий tier+features+quotas
 *                                                              текущей Org (без `notes`).
 *   - GET   /api/v1/settings/billing                         — то же + `notes` (owner-only).
 *   - GET   /api/v1/admin/orgs/:tenantId/entitlement         — Z-Admin (super_admin).
 *   - PATCH /api/v1/admin/orgs/:tenantId/entitlement         — Z-Admin: смена tier'а / overrides.
 */

import { apiClient } from './api-client';
import type {
  EntitlementApi,
  PatchEntitlementBody,
} from '@/domain/entitlement';

export const entitlementsApi = {
  /** GET /api/v1/me/entitlements — для всех залогиненных. Без notes. */
  getMe: () => apiClient.get<EntitlementApi>('/api/v1/me/entitlements'),

  /** GET /api/v1/settings/billing — owner-only. С notes. */
  getBilling: () => apiClient.get<EntitlementApi>('/api/v1/settings/billing'),

  /** GET /api/v1/admin/orgs/:tenantId/entitlement — super_admin only. */
  getAdminOrg: (tenantId: string) =>
    apiClient.get<EntitlementApi>(
      `/api/v1/admin/orgs/${encodeURIComponent(tenantId)}/entitlement`,
    ),

  /** PATCH /api/v1/admin/orgs/:tenantId/entitlement — super_admin only. */
  patchAdminOrg: (tenantId: string, patch: PatchEntitlementBody) =>
    apiClient.patch<EntitlementApi>(
      `/api/v1/admin/orgs/${encodeURIComponent(tenantId)}/entitlement`,
      patch,
    ),
};
