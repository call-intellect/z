/**
 * API-клиент модуля tracker.sprint-hints.
 *
 * Контракты:
 *   - `backend/src/modules/tracker/controllers/cycles.controller.ts`
 *     (GET /api/v1/cycles/:id/hints — listByCycle).
 *   - `backend/src/modules/tracker/controllers/sprint-hints.controller.ts`
 *     (POST /api/v1/sprint-hints/:id/dismiss | /resolve).
 *
 * Auth: `CookieAuthGuard + TenantGuard` (cookie + `X-Org-Id` header).
 */

import { apiClient } from '../api-client';
import { orgHeaders } from '../admin-helpers';
import type {
  ListSprintHintsResponseApi,
  SprintHintApi,
} from '@/domain/sprint';

export const sprintHintsApi = {
  listByCycle: (orgId: string, cycleId: string) =>
    apiClient.get<ListSprintHintsResponseApi>(
      `/api/v1/cycles/${encodeURIComponent(cycleId)}/hints`,
      { headers: orgHeaders(orgId) },
    ),

  dismiss: (orgId: string, hintId: string) =>
    apiClient.post<SprintHintApi>(
      `/api/v1/sprint-hints/${encodeURIComponent(hintId)}/dismiss`,
      undefined,
      { headers: orgHeaders(orgId) },
    ),

  resolve: (orgId: string, hintId: string) =>
    apiClient.post<SprintHintApi>(
      `/api/v1/sprint-hints/${encodeURIComponent(hintId)}/resolve`,
      undefined,
      { headers: orgHeaders(orgId) },
    ),
};
