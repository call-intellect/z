/**
 * G.2 KC-Temporal (2026-05-25) — API-клиент для admin signal-type-monitor.
 *
 * Backend: `backend/src/modules/admin/signal-type-monitor/
 * signal-type-monitor.controller.ts`.
 */
import { apiClient } from './api-client';
import type {
  AdminSignalTypeMonitorItemApi,
  AdminSignalTypeMonitorListApi,
} from '@/domain/admin-signal-type-monitor';

export const adminSignalTypeMonitorApi = {
  list: () =>
    apiClient.get<AdminSignalTypeMonitorListApi>(
      '/api/v1/admin/llm/signal-type-monitor',
    ),

  getByTenant: (tenantId: string) =>
    apiClient.get<AdminSignalTypeMonitorItemApi>(
      `/api/v1/admin/llm/signal-type-monitor/${encodeURIComponent(tenantId)}`,
    ),
};
