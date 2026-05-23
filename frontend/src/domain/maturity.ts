/**
 * SBA α-9 wave 3 — доменная модель Maturity.
 */

import type {
  MaturityOverviewApi,
  MaturityScopeApi,
  MaturityScopeDetailApi,
} from '@/api/maturity.api';

export const MATURITY_SCOPE_LABEL: Record<MaturityScopeApi, string> = {
  role: 'Должность',
  department: 'Отдел',
  company: 'Компания',
};

export interface MaturityOverviewDomain {
  companyScore: number | null;
  companyPercent: number | null;
  lastCalcAt: Date | null;
  averageRolePercent: number | null;
  averageDepartmentPercent: number | null;
  rolesTotal: number;
  rolesScored: number;
  departmentsTotal: number;
  departmentsScored: number;
  domainsTotal: number;
  domainsScored: number;
  distribution: { bucket: string; count: number }[];
}

export interface MaturityScopeDetailDomain {
  scope: MaturityScopeApi;
  id: string;
  name: string;
  maturityScore: number | null;
  maturityPercent: number | null;
  completeness: number | null;
  contributingFactors: { label: string; value: number; weight: number }[];
  children: { id: string; name: string; maturityPercent: number | null }[];
}

function toPercent(v: number | null): number | null {
  if (v === null || Number.isNaN(v)) return null;
  return Math.round(Math.max(0, Math.min(1, v)) * 100);
}

export function toMaturityOverviewDomain(
  api: MaturityOverviewApi,
): MaturityOverviewDomain {
  return {
    companyScore: api.companyScore,
    companyPercent: toPercent(api.companyScore),
    lastCalcAt: api.lastCalcAt ? new Date(api.lastCalcAt) : null,
    averageRolePercent: toPercent(api.averageRoleScore),
    averageDepartmentPercent: toPercent(api.averageDepartmentScore),
    rolesTotal: api.rolesTotal,
    rolesScored: api.rolesScored,
    departmentsTotal: api.departmentsTotal,
    departmentsScored: api.departmentsScored,
    domainsTotal: api.domainsTotal,
    domainsScored: api.domainsScored,
    distribution: api.distribution,
  };
}

export function toMaturityScopeDetailDomain(
  api: MaturityScopeDetailApi,
): MaturityScopeDetailDomain {
  return {
    scope: api.scope,
    id: api.id,
    name: api.name,
    maturityScore: api.maturityScore,
    maturityPercent: toPercent(api.maturityScore),
    completeness: api.completeness,
    contributingFactors: api.contributingFactors ?? [],
    children: (api.children ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      maturityPercent: toPercent(c.maturityScore),
    })),
  };
}
