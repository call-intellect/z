/**
 * API-клиент для CRUD тарифов (Plan) — Z-Admin Фаза 4.
 *
 * Контракт сервера: `backend/src/modules/admin/plans/plans.controller.ts`
 * (префикс `/api/v1/admin/orgs/plans`).
 */

import { apiClient } from './api-client';
import { buildQuery } from './admin-helpers';
import type {
  CreatePlanRequest,
  PlanItemApi,
  PlanListApi,
  PlanUsageApi,
  UpdatePlanRequest,
} from '@/domain/admin-plan';

export const adminPlansApi = {
  list: () =>
    apiClient.get<PlanListApi>('/api/v1/admin/orgs/plans'),

  create: (body: CreatePlanRequest) =>
    apiClient.post<PlanItemApi>('/api/v1/admin/orgs/plans', body),

  update: (id: string, body: UpdatePlanRequest) =>
    apiClient.patch<PlanItemApi>(
      `/api/v1/admin/orgs/plans/${encodeURIComponent(id)}`,
      body,
    ),

  /**
   * По умолчанию soft-delete (isActive=false). С `hard=true` — полностью удаляет
   * запись из БД (бэкенд вернёт 400, если хотя бы одна Org использует тариф).
   */
  remove: (id: string, opts: { hard?: boolean } = {}) =>
    apiClient.del<{ ok: true }>(
      `/api/v1/admin/orgs/plans/${encodeURIComponent(id)}${buildQuery({ hard: opts.hard })}`,
    ),

  usage: (id: string) =>
    apiClient.get<PlanUsageApi>(
      `/api/v1/admin/orgs/plans/${encodeURIComponent(id)}/usage`,
    ),
};
