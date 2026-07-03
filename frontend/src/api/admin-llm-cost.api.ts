import { apiClient } from "./api-client";
import { buildQuery } from "./admin-helpers";

export type LlmCostPeriod = "7d" | "30d" | "90d";
export type LlmCostTrendGranularity = "day" | "week";
export type LlmCostModule = "memory_graph" | "extraction" | "agent" | "other";

export type LlmCostTrendPointApi = {
  date: string;
  costRub: number;
};

export type LlmCostOverviewApi = {
  period: LlmCostPeriod;
  totals: {
    costRub: number;
    callsCount: number;
    prevPeriodCostRub: number | null;
    changePct: number | null;
  };
  trend: LlmCostTrendPointApi[];
  byModel: Array<{ model: string; costRub: number; sharePct: number }>;
  byModule: Array<{
    module: LlmCostModule;
    label: string;
    costRub: number;
    sharePct: number;
  }>;
  topCompanies: Array<{
    tenantId: string;
    name: string;
    costRub: number;
    sharePct: number;
  }>;
};

export type LlmCostModelDetailApi = {
  model: string;
  totals: { costRub: number; sharePct: number };
  trend: LlmCostTrendPointApi[];
  byModule: Array<{
    module: LlmCostModule;
    label: string;
    costRub: number;
    sharePct: number;
  }>;
};

export type LlmCostModuleDetailApi = {
  module: LlmCostModule;
  label: string;
  totals: { costRub: number; sharePct: number };
  trend: LlmCostTrendPointApi[];
  byTaskType: Array<{ taskType: string; costRub: number; callsCount: number }>;
};

export type LlmCostCompanyRowApi = {
  tenantId: string;
  name: string;
  costRub: number;
  sharePct: number;
  trend: LlmCostTrendPointApi[];
};

export type LlmCostCompaniesApi = {
  items: LlmCostCompanyRowApi[];
  nextCursor: string | null;
};

export type LlmCostCompanyDetailApi = {
  tenantId: string;
  name: string;
  totals: { costRub: number };
  trend: LlmCostTrendPointApi[];
  byModel: Array<{ model: string; costRub: number; sharePct: number }>;
};

export type LlmCostTaskTypeDetailApi = {
  taskType: string;
  module: LlmCostModule;
  totals: { costRub: number; callsCount: number };
  trend: LlmCostTrendPointApi[];
};

export type LlmCostPeriodQuery = {
  period: LlmCostPeriod;
  trend?: LlmCostTrendGranularity;
};

export type LlmCostCompaniesRequest = {
  period: LlmCostPeriod;
  limit?: number;
  cursor?: string;
  search?: string;
};

export const adminLlmCostApi = {
  overview: (req: LlmCostPeriodQuery) =>
    apiClient.get<LlmCostOverviewApi>(
      `/api/v1/admin/llm-cost/overview${buildQuery({ ...req })}`,
    ),

  modelDetail: (model: string, req: LlmCostPeriodQuery) =>
    apiClient.get<LlmCostModelDetailApi>(
      `/api/v1/admin/llm-cost/models/${encodeURIComponent(model)}${buildQuery({ ...req })}`,
    ),

  moduleDetail: (module: LlmCostModule, req: LlmCostPeriodQuery) =>
    apiClient.get<LlmCostModuleDetailApi>(
      `/api/v1/admin/llm-cost/modules/${encodeURIComponent(module)}${buildQuery({ ...req })}`,
    ),

  companies: (req: LlmCostCompaniesRequest) =>
    apiClient.get<LlmCostCompaniesApi>(
      `/api/v1/admin/llm-cost/companies${buildQuery({ ...req })}`,
    ),

  companyDetail: (tenantId: string, req: LlmCostPeriodQuery) =>
    apiClient.get<LlmCostCompanyDetailApi>(
      `/api/v1/admin/llm-cost/companies/${encodeURIComponent(tenantId)}${buildQuery({ ...req })}`,
    ),

  taskTypeDetail: (taskType: string, req: LlmCostPeriodQuery) =>
    apiClient.get<LlmCostTaskTypeDetailApi>(
      `/api/v1/admin/llm-cost/task-types/${encodeURIComponent(taskType)}${buildQuery({ ...req })}`,
    ),
};
