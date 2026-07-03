import { apiClient } from "./api-client";
import { buildQuery } from "./admin-helpers";
import type {
  AdminCallDetailApi,
  AdminCallsLogApi,
  AdminDashboardApi,
  AdminFunctionsUsageApi,
  AdminPeriod,
} from "@/domain/admin-usage";

export type DashboardRequest = {
  period: AdminPeriod;
  from?: string;
  to?: string;
};

export type CallsLogRequest = {
  taskType?: string;
  userId?: string;
  experimentGroup?: "A" | "B";
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
  kind?: "calls" | "functions";
};

export const adminUsageApi = {
  getDashboard: (req: DashboardRequest) =>
    apiClient.get<AdminDashboardApi>(
      `/api/v1/admin/usage/dashboard${buildQuery({ ...req })}`,
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
    apiClient.get<{ items: AdminCallsLogApi["items"] }>(
      `/api/v1/admin/usage/functions/${encodeURIComponent(taskType)}/calls${buildQuery({ ...req })}`,
    ),

  exportCsvUrl: (req: ExportCsvRequest) =>
    `/api/v1/admin/usage/export/usage.csv${buildQuery({ ...req })}`,
};
