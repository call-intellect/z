/**
 * Tracker Project Overview (2026-05-27) — API клиенты для трёх вкладок
 * /overview /workload /integrations.
 *
 * Контракт: `backend/src/modules/tracker/controllers/overview.controller.ts`.
 */

import { apiClient } from '../api-client';
import { orgHeaders } from '../admin-helpers';
import type {
  IntegrationsStatusApi,
  OverviewResponseApi,
  WorkloadResponseApi,
} from '@/domain/tracker/overview';

export const overviewApi = {
  getOverview: (orgId: string, projectId: string) =>
    apiClient.get<OverviewResponseApi>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/overview`,
      { headers: orgHeaders(orgId) },
    ),

  getWorkload: (orgId: string, projectId: string) =>
    apiClient.get<WorkloadResponseApi>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/workload`,
      { headers: orgHeaders(orgId) },
    ),

  getIntegrationsStatus: (orgId: string, projectId: string) =>
    apiClient.get<IntegrationsStatusApi>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/integrations-status`,
      { headers: orgHeaders(orgId) },
    ),
};
