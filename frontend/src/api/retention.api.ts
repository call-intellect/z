/**
 * API-клиент для `/api/v1/settings/retention` (Фаза 11 knowledge-core / 152-ФЗ).
 *
 * Контракт: `backend/src/modules/retention/retention-policy.controller.ts`.
 * Защита: `CookieAuthGuard + TenantGuard`, owner-only.
 */

import { apiClient } from './api-client';
import { orgHeaders } from './admin-helpers';
import type {
  OrgRetentionPolicyApi,
  UpdateRetentionPolicyRequest,
} from '@/domain/retention';

export const retentionApi = {
  get: (orgId: string) =>
    apiClient.get<OrgRetentionPolicyApi>('/api/v1/settings/retention', {
      headers: orgHeaders(orgId),
    }),

  update: (orgId: string, body: UpdateRetentionPolicyRequest) =>
    apiClient.patch<OrgRetentionPolicyApi>(
      '/api/v1/settings/retention',
      body,
      { headers: orgHeaders(orgId) },
    ),
};
