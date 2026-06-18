import { z } from 'zod';

export const MaturityScopeSchema = z.enum(['role', 'department', 'company']);
export type MaturityScope = z.infer<typeof MaturityScopeSchema>;

export interface MaturityOverviewDto {
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

export interface MaturityScopeDetailDto {
  scope: 'role' | 'department' | 'company';
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

export interface RebuildMaturityResponseDto {
  ok: true;
  scopes: {
    roles: { scanned: number; updated: number };
    departments: { scanned: number; updated: number };
    company: { updated: boolean };
  };
  durationMs: number;
}
