import { apiClient } from "./api-client";
import { orgHeaders } from "./admin-helpers";

export interface MaturityOverviewApi {
  companyScore: number | null;
  lastCalcAt: string | null;
  averageRoleScore: number | null;
  averageDepartmentScore: number | null;
  rolesTotal: number;
  rolesScored: number;
  departmentsTotal: number;
  departmentsScored: number;
  domainsTotal: number;
  domainsScored: number;
  distribution: {
    bucket: string;
    count: number;
  }[];
}

export type MaturityScopeApi = "role" | "department" | "company";

export interface MaturityScopeDetailApi {
  scope: MaturityScopeApi;
  id: string;
  name: string;
  maturityScore: number | null;
  completeness: number | null;
  contributingFactors?: {
    label: string;
    value: number;
    weight: number;
  }[];
  children?: {
    id: string;
    name: string;
    maturityScore: number | null;
  }[];
}

export interface RebuildMaturityResponseApi {
  ok: true;
  scopes: {
    roles: { scanned: number; updated: number };
    departments: { scanned: number; updated: number };
    company: { updated: boolean };
  };
  durationMs: number;
}

export const maturityApi = {
  overview: (orgId: string) =>
    apiClient.get<MaturityOverviewApi>("/api/v1/maturity/overview", {
      headers: orgHeaders(orgId),
    }),

  scope: (orgId: string, scope: MaturityScopeApi, id: string) =>
    apiClient.get<MaturityScopeDetailApi>(
      `/api/v1/maturity/scope/${scope}/${encodeURIComponent(id)}`,
      { headers: orgHeaders(orgId) },
    ),

  rebuild: (orgId: string) =>
    apiClient.post<RebuildMaturityResponseApi>(
      "/api/v1/maturity/rebuild",
      undefined,
      { headers: orgHeaders(orgId) },
    ),
};
