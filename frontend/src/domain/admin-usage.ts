export type AdminPeriod = "day" | "week" | "month" | "custom";

export const ADMIN_PERIOD_LABELS: Record<AdminPeriod, string> = {
  day: "За сутки",
  week: "За неделю",
  month: "За месяц",
  custom: "Свой период",
};

export type AdminScope = "global" | "org";

export type AdminDashboardApi = {
  scope: AdminScope;
  tenantId: string | null;
  period: { from: string; to: string; kind: AdminPeriod };
  totals: {
    totalCostUsd: number;
    totalCalls: number;
    failedCalls: number;
  };
  byProvider: Array<{ provider: string; costUsd: number; calls: number }>;
  byTaskType: Array<{ taskType: string; costUsd: number; calls: number }>;
  topOrgs?: Array<{
    tenantId: string;
    name: string;
    costUsd: number;
    calls: number;
  }>;
  counts?: {
    orgsTotal: number;
    usersTotal: number;
    activeUsers7d: number;
  };
};

export type AdminDashboardDomain = {
  scope: AdminScope;
  tenantId: string | null;
  period: { from: Date; to: Date; kind: AdminPeriod };
  totals: {
    totalCostUsd: number;
    totalCalls: number;
    failedCalls: number;
    failRate: number;
  };
  byProvider: Array<{ provider: string; costUsd: number; calls: number }>;
  byTaskType: Array<{ taskType: string; costUsd: number; calls: number }>;
  topOrgs: Array<{
    tenantId: string;
    name: string;
    costUsd: number;
    calls: number;
  }>;
  counts: {
    orgsTotal: number;
    usersTotal: number;
    activeUsers7d: number;
  } | null;
};

export function adminDashboardFromApi(
  api: AdminDashboardApi,
): AdminDashboardDomain {
  const totalCalls = api.totals.totalCalls;
  return {
    scope: api.scope,
    tenantId: api.tenantId,
    period: {
      from: new Date(api.period.from),
      to: new Date(api.period.to),
      kind: api.period.kind,
    },
    totals: {
      totalCostUsd: api.totals.totalCostUsd,
      totalCalls: api.totals.totalCalls,
      failedCalls: api.totals.failedCalls,
      failRate: totalCalls > 0 ? api.totals.failedCalls / totalCalls : 0,
    },
    byProvider: api.byProvider,
    byTaskType: api.byTaskType,
    topOrgs: api.topOrgs ?? [],
    counts: api.counts ?? null,
  };
}

export type AdminUsersUsageRowApi = {
  userId: string;
  userEmail: string;
  userName: string;
  tenantId: string | null;
  tenantName: string | null;
  totalCostUsd: number;
  totalCalls: number;
  byTaskType: Array<{ taskType: string; costUsd: number; calls: number }>;
};

export type AdminUsersUsageApi = {
  items: AdminUsersUsageRowApi[];
  nextCursor: string | null;
};

export type AdminUsersUsageRowDomain = AdminUsersUsageRowApi;

export type AdminUsersUsageDomain = {
  items: AdminUsersUsageRowDomain[];
  nextCursor: string | null;
};

export function adminUsersUsageFromApi(
  api: AdminUsersUsageApi,
): AdminUsersUsageDomain {
  return {
    items: api.items,
    nextCursor: api.nextCursor,
  };
}

export type AdminCallLogItemApi = {
  id: string;
  createdAt: string;
  tenantId: string | null;
  taskType: string | null;
  userId: string | null;
  userEmail: string | null;
  meetingId: string | null;
  meetingTitle: string | null;
  agentType: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd: number;
  durationMs: number;
  success: boolean;
  errorText: string | null;
  experimentGroup: string | null;
  sourceRef: { type: string; id: string } | null;
};

export type AdminCallLogItemDomain = Omit<AdminCallLogItemApi, "createdAt"> & {
  createdAt: Date;
};

export type AdminCallsLogApi = {
  items: AdminCallLogItemApi[];
  nextCursor: string | null;
};

export type AdminCallsLogDomain = {
  items: AdminCallLogItemDomain[];
  nextCursor: string | null;
};

export function adminCallLogItemFromApi(
  api: AdminCallLogItemApi,
): AdminCallLogItemDomain {
  return { ...api, createdAt: new Date(api.createdAt) };
}

export function adminCallsLogFromApi(
  api: AdminCallsLogApi,
): AdminCallsLogDomain {
  return {
    items: api.items.map(adminCallLogItemFromApi),
    nextCursor: api.nextCursor,
  };
}

export type AdminCallDetailApi = AdminCallLogItemApi & {
  requestPreview: string | null;
  responsePreview: string | null;
};

export type AdminCallDetailDomain = AdminCallLogItemDomain & {
  requestPreview: string | null;
  responsePreview: string | null;
};

export function adminCallDetailFromApi(
  api: AdminCallDetailApi,
): AdminCallDetailDomain {
  return {
    ...adminCallLogItemFromApi(api),
    requestPreview: api.requestPreview,
    responsePreview: api.responsePreview,
  };
}

export type AdminFunctionUsageRowApi = {
  taskType: string;
  hasRoute: boolean;
  isActive: boolean;
  experimentEnabled: boolean;
  currentProvider: string | null;
  fallbackChain: string[];
  totalCalls: number;
  failedCalls: number;
  failRate: number;
  avgCostUsd: number;
  avgDurationMs: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  totalCostUsd: number;
};

export type AdminFunctionsUsageApi = {
  items: AdminFunctionUsageRowApi[];
};

export type AdminFunctionUsageRowDomain = AdminFunctionUsageRowApi;

export type AdminFunctionsUsageDomain = {
  items: AdminFunctionUsageRowDomain[];
};

export function adminFunctionsUsageFromApi(
  api: AdminFunctionsUsageApi,
): AdminFunctionsUsageDomain {
  return { items: api.items };
}

export function formatUsd(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms} мс`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} с`;
  return `${(ms / 60_000).toFixed(1)} мин`;
}
