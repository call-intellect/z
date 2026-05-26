/**
 * API-клиент `org-admin/memory-access` (ТЗ 2026-05-26 §6).
 *
 * Контракт: `backend/src/modules/admin/controllers/org-admin-memory-access.controller.ts`.
 *
 * RBAC: только owner / admin Org (через OrgAdminGuard).
 */

import { apiClient } from './api-client';

export interface MemoryAccessApi {
  regulationsForMembers: boolean;
  entitiesForMembers: boolean;
}

export interface UpdateMemoryAccessApi {
  regulationsForMembers?: boolean;
  entitiesForMembers?: boolean;
}

export const adminMemoryAccessApi = {
  get: () => apiClient.get<MemoryAccessApi>('/api/v1/admin/org/memory-access'),
  patch: (body: UpdateMemoryAccessApi) =>
    apiClient.patch<MemoryAccessApi>('/api/v1/admin/org/memory-access', body),
};
