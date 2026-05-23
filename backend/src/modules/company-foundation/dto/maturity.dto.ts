import { z } from 'zod';

/**
 * SBA α-9 wave 3 — DTO для /api/v1/maturity.
 */

export const MaturityScopeSchema = z.enum(['role', 'department', 'company']);
export type MaturityScope = z.infer<typeof MaturityScopeSchema>;

export interface MaturityOverviewDto {
  /** maturity Org (взвешенное среднее по Department.maturityScore). */
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
  /** Распределение по корзинам зрелости (0..1) для гистограммы UI. */
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
  /** Дети unit'а (для drill-down). */
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
