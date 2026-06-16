import { apiClient } from "./api-client";
import { orgHeaders } from "./admin-helpers";

export interface CompanyProfileApi {
  id: string;
  tenantId: string;
  displayName: string | null;
  mission: {
    contentMd: string;
    horizon?: string;
    targetDate?: string;
  } | null;
  vision: {
    contentMd: string;
    horizonYears?: number;
    targetDate?: string;
  } | null;
  strategy: {
    contentMd: string;
    markets?: string[];
    bets?: string[];
    horizon?: string;
    targetDate?: string;
  } | null;
  targetMarketIds: string[];
  maturityScore: number | null;
  lastMaturityCalcAt: string | null;
  stage: string | null;
  sourceBlockIds: string[];
  confidence: number | null;
  createdAt: string;
  updatedAt: string;
}

export type CompanyStageApi = "early_stage" | "growth" | "scale" | "enterprise";
export type StrategyHorizonApi =
  | "operational"
  | "tactical"
  | "strategic"
  | "long_term";

export interface UpdateCompanyProfileRequest {
  displayName?: string;
  mission?: {
    contentMd: string;
    horizon?: StrategyHorizonApi;
    targetDate?: string;
  } | null;
  vision?: {
    contentMd: string;
    horizonYears?: number;
    targetDate?: string;
  } | null;
  strategy?: {
    contentMd: string;
    markets?: string[];
    bets?: string[];
    horizon?: StrategyHorizonApi;
    targetDate?: string;
  } | null;
  targetMarketIds?: string[];
  stage?: CompanyStageApi | null;
}

export interface RebuildCompletenessResponseApi {
  ok: true;
  enqueued: boolean;
  reason: string;
}

export const companyApi = {
  get: (orgId: string) =>
    apiClient.get<CompanyProfileApi>("/api/v1/company", {
      headers: orgHeaders(orgId),
    }),

  update: (orgId: string, body: UpdateCompanyProfileRequest) =>
    apiClient.patch<CompanyProfileApi>("/api/v1/company", body, {
      headers: orgHeaders(orgId),
    }),

  rebuildCompleteness: (orgId: string) =>
    apiClient.post<RebuildCompletenessResponseApi>(
      "/api/v1/company/rebuild-completeness",
      undefined,
      { headers: orgHeaders(orgId) },
    ),
};
