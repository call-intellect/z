/**
 * API-клиент для Z-Admin usage endpoints (Фаза 7).
 *
 * Контракт: `backend/src/modules/admin/controllers/admin-usage.controller.ts`
 * под префиксом `/api/v1/admin/usage`. Защита — `SuperAdminGuard`.
 *
 * Ошибка 403 = `forbidden` (выкидывает `ApiClient`) — UI показывает empty-state.
 */

import { apiClient } from './api-client';
import { buildQuery } from './admin-helpers';
import type {
  AdminCallDetailApi,
  AdminCallsLogApi,
  AdminDashboardApi,
  AdminFunctionsUsageApi,
  AdminPeriod,
  AdminUsersUsageApi,
} from '@/domain/admin-usage';

export type DashboardRequest = {
  period: AdminPeriod;
  from?: string;
  to?: string;
};

export type UsersUsageRequest = DashboardRequest & {
  limit?: number;
  cursor?: string;
  search?: string;
};

export type CallsLogRequest = {
  taskType?: string;
  userId?: string;
  experimentGroup?: 'A' | 'B';
  limit?: number;
  cursor?: string;
};

export type FunctionsUsageRequest = DashboardRequest;

export type FunctionCallsRequest = {
  limit?: number;
};

export type ExportCsvRequest = {
  period: AdminPeriod;
  from?: string;
  to?: string;
  kind?: 'calls' | 'users' | 'functions';
};

export const adminUsageApi = {
  getDashboard: (req: DashboardRequest) =>
    apiClient.get<AdminDashboardApi>(
      `/api/v1/admin/usage/dashboard${buildQuery({ ...req })}`,
    ),

  getUsers: (req: UsersUsageRequest) =>
    apiClient.get<AdminUsersUsageApi>(
      `/api/v1/admin/usage/users${buildQuery({ ...req })}`,
    ),

  getCalls: (req: CallsLogRequest) =>
    apiClient.get<AdminCallsLogApi>(
      `/api/v1/admin/usage/calls${buildQuery({ ...req })}`,
    ),

  getCallDetails: (callId: string) =>
    apiClient.get<AdminCallDetailApi>(
      `/api/v1/admin/usage/calls/${encodeURIComponent(callId)}`,
    ),

  getFunctions: (req: FunctionsUsageRequest) =>
    apiClient.get<AdminFunctionsUsageApi>(
      `/api/v1/admin/usage/functions${buildQuery({ ...req })}`,
    ),

  getFunctionCalls: (taskType: string, req: FunctionCallsRequest = {}) =>
    apiClient.get<{ items: AdminCallsLogApi['items'] }>(
      `/api/v1/admin/usage/functions/${encodeURIComponent(taskType)}/calls${buildQuery({ ...req })}`,
    ),

  /** URL для прямой загрузки CSV (frontend открывает в новой вкладке). */
  exportCsvUrl: (req: ExportCsvRequest) =>
    `/api/v1/admin/usage/export/usage.csv${buildQuery({ ...req })}`,
};
