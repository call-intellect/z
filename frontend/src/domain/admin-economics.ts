export type AdminEconomicsGlobalApi = {
  period: { fromIso: string; toIso: string; days: number };
  totals: { costUsd: number; costRub: number; callsCount: number };
  topOrgs: Array<{
    tenantId: string;
    orgName: string;
    costRub: number;
    calls: number;
  }>;
  byTaskType: Array<{ taskType: string; costRub: number; calls: number }>;
};

export type AdminEconomicsOrgApi = {
  tenantId: string;
  orgName: string;
  currencyRate: number;
  costUsdLast30d: number;
  costRubLast30d: number;
  costRubMonthToDate: number;
  callsCountLast30d: number;
  avgCostPerUserRub: number;
  activeUsersLast30d: number;
  topTaskTypes: Array<{
    taskType: string;
    costRub: number;
    calls: number;
  }>;
  budget: {
    monthlyCapRub: number | null;
    capKind: string;
    alertThresholds: number[];
    lastAlertAt: string | null;
    lastAlertThreshold: number | null;
    utilizationPercent: number | null;
  } | null;
};

export type AdminOrgBudgetApi = {
  id: string;
  tenantId: string;
  monthlyCapRub: string | number | null;
  capKind: string;
  alertThresholds: number[];
  lastAlertAt: string | null;
  lastAlertThreshold: number | null;
  setByUserId: string | null;
};

export type UpdateOrgBudgetRequest = {
  monthlyCapRub: number | null;
  capKind: "soft" | "hard" | "downgrade";
  alertThresholds: number[];
};
