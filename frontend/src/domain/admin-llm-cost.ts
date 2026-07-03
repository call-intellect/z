import type {
  LlmCostCompaniesApi,
  LlmCostCompanyDetailApi,
  LlmCostCompanyRowApi,
  LlmCostModelDetailApi,
  LlmCostModule,
  LlmCostModuleDetailApi,
  LlmCostOverviewApi,
  LlmCostPeriod,
  LlmCostTaskTypeDetailApi,
  LlmCostTrendGranularity,
  LlmCostTrendPointApi,
} from "@/api/admin-llm-cost.api";

export type {
  LlmCostModule,
  LlmCostPeriod,
  LlmCostTrendGranularity,
} from "@/api/admin-llm-cost.api";

export const LLM_COST_PERIODS: LlmCostPeriod[] = ["7d", "30d", "90d"];

export const LLM_COST_PERIOD_LABELS: Record<LlmCostPeriod, string> = {
  "7d": "7д",
  "30d": "30д",
  "90d": "90д",
};

export function isLlmCostPeriod(value: string | null): value is LlmCostPeriod {
  return value !== null && (LLM_COST_PERIODS as string[]).includes(value);
}

const LLM_COST_MODULES: LlmCostModule[] = [
  "memory_graph",
  "extraction",
  "agent",
  "other",
];

export function isLlmCostModule(value: string | null): value is LlmCostModule {
  return value !== null && (LLM_COST_MODULES as string[]).includes(value);
}

export type LlmCostTrendPoint = LlmCostTrendPointApi;

export type LlmCostOverviewDomain = LlmCostOverviewApi;
export type LlmCostModelDetailDomain = LlmCostModelDetailApi;
export type LlmCostModuleDetailDomain = LlmCostModuleDetailApi;
export type LlmCostCompanyRowDomain = LlmCostCompanyRowApi;
export type LlmCostCompaniesDomain = LlmCostCompaniesApi;
export type LlmCostCompanyDetailDomain = LlmCostCompanyDetailApi;
export type LlmCostTaskTypeDetailDomain = LlmCostTaskTypeDetailApi;

export function llmCostOverviewFromApi(
  api: LlmCostOverviewApi,
): LlmCostOverviewDomain {
  return api;
}

export function llmCostModelDetailFromApi(
  api: LlmCostModelDetailApi,
): LlmCostModelDetailDomain {
  return api;
}

export function llmCostModuleDetailFromApi(
  api: LlmCostModuleDetailApi,
): LlmCostModuleDetailDomain {
  return api;
}

export function llmCostCompaniesFromApi(
  api: LlmCostCompaniesApi,
): LlmCostCompaniesDomain {
  return api;
}

export function llmCostCompanyDetailFromApi(
  api: LlmCostCompanyDetailApi,
): LlmCostCompanyDetailDomain {
  return api;
}

export function llmCostTaskTypeDetailFromApi(
  api: LlmCostTaskTypeDetailApi,
): LlmCostTaskTypeDetailDomain {
  return api;
}

export function formatRub(rub: number): string {
  return `${Math.round(rub).toLocaleString("ru-RU")} ₽`;
}

export function formatSharePct(sharePct: number): string {
  return `${sharePct >= 10 ? Math.round(sharePct) : sharePct.toFixed(1)}%`;
}
