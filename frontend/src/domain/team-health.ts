/**
 * Domain-типы для Team Health Grid (Pulse Wave 1 §1.6).
 *
 * Источник правды: `backend/src/modules/dashboard/services/team-health.service.ts`.
 * GET `/api/v1/dashboard/team-health` → `TeamHealthApi`.
 *
 * Mapping ApiDto → DomainModel здесь тождественный (поля простые,
 * сериализация не нужна). Если в будущем добавится `Date` или
 * нормализация — менять мапперы здесь, без правки UI.
 */

export type HealthToneApi = 'success' | 'warning' | 'danger' | 'neutral';

export type TeamHealthAttrApi = {
  value: number;
  tone: HealthToneApi;
  trend?: 'up' | 'flat' | 'down';
  delta?: number | null;
};

export type TeamHealthFactorLevelApi = 'low' | 'medium' | 'high';

export type TeamHealthSummaryApi = {
  factors: {
    manager_support: TeamHealthFactorLevelApi;
    workload_fairness: TeamHealthFactorLevelApi;
    communication: TeamHealthFactorLevelApi;
    time_pressure: TeamHealthFactorLevelApi;
    role_clarity: TeamHealthFactorLevelApi;
  };
  summary: string;
  generatedAt: string;
};

export type TeamHealthRowApi = {
  departmentId: string;
  departmentName: string;
  size: number;
  belowCohort: boolean;
  sentiment: TeamHealthAttrApi;
  promises: TeamHealthAttrApi;
  conflicts: TeamHealthAttrApi;
  decisions: TeamHealthAttrApi;
  healthSummary?: TeamHealthSummaryApi | null;
};

export type TeamHealthApi = {
  teams: TeamHealthRowApi[];
  totalDepartments: number;
};

// Domain — alias (типы простые, без нормализации).
export type HealthToneDomain = HealthToneApi;
export type TeamHealthAttrDomain = TeamHealthAttrApi;
export type TeamHealthRowDomain = TeamHealthRowApi;
export type TeamHealthDomain = TeamHealthApi;

export function teamHealthFromApi(api: TeamHealthApi): TeamHealthDomain {
  return api;
}
