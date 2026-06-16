import { apiClient } from "./api-client";
import { buildQuery } from "./admin-helpers";
import type {
  AdminEconomicsGlobalApi,
  AdminEconomicsOrgApi,
  AdminOrgBudgetApi,
  UpdateOrgBudgetRequest,
} from "@/domain/admin-economics";

export const adminEconomicsApi = {
  global: (req: { days?: number; topN?: number } = {}) =>
    apiClient.get<AdminEconomicsGlobalApi>(
      `/api/v1/admin/unit-economics/global${buildQuery({
        days: req.days,
        topN: req.topN,
      })}`,
    ),

  org: (tenantId: string, req: { days?: number } = {}) =>
    apiClient.get<AdminEconomicsOrgApi>(
      `/api/v1/admin/unit-economics/orgs/${tenantId}${buildQuery({
        days: req.days,
      })}`,
    ),

  getBudget: (tenantId: string) =>
    apiClient.get<AdminOrgBudgetApi | null>(
      `/api/v1/admin/orgs/${tenantId}/budget`,
    ),

  setBudget: (tenantId: string, body: UpdateOrgBudgetRequest) =>
    apiClient.patch<AdminOrgBudgetApi>(
      `/api/v1/admin/orgs/${tenantId}/budget`,
      body,
    ),

  aggregate: (body: { date?: string } = {}) =>
    apiClient.post<{
      date: string;
      rowsAggregated: number;
      rowsUpserted: number;
    }>("/api/v1/admin/unit-economics/aggregate", body),
};

export const orgEconomicsApi = {
  current: (req: { days?: number } = {}) =>
    apiClient.get<AdminEconomicsOrgApi>(
      `/api/v1/org/economics/current${buildQuery({ days: req.days })}`,
    ),
};
