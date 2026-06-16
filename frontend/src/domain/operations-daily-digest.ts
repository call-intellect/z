import type {
  DailyDigestApi,
  DailyDigestChronicBlockerApi,
  DailyDigestCustomerAtRiskApi,
  DailyDigestEventApi,
  DailyDigestMetricsApi,
  DailyDigestPersonShinedApi,
  DailyDigestPersonStruggledApi,
  DailyDigestSourcesApi,
  DailyDigestTrendPointApi,
  DailyDigestUrgentItemApi,
} from "@/api/operations-daily-digest.api";

export interface DailyDigestMetricsDomain extends DailyDigestMetricsApi {}

export interface DailyDigestSourcesDomain extends DailyDigestSourcesApi {}

export interface DailyDigestEventDomain extends DailyDigestEventApi {}
export interface DailyDigestUrgentItemDomain extends DailyDigestUrgentItemApi {}
export interface DailyDigestPersonShinedDomain extends DailyDigestPersonShinedApi {}
export interface DailyDigestPersonStruggledDomain extends DailyDigestPersonStruggledApi {}
export interface DailyDigestChronicBlockerDomain extends DailyDigestChronicBlockerApi {}
export interface DailyDigestCustomerAtRiskDomain extends DailyDigestCustomerAtRiskApi {}

export const CHRONIC_BLOCKER_STATUS_LABEL: Record<
  DailyDigestChronicBlockerDomain["status"],
  string
> = {
  new: "новый",
  recurring: "повторяется",
  resolved: "закрыт",
};

export interface DailyDigestDomain {
  id: string;
  tenantId: string;
  dateLocal: string;
  bodyMarkdown: string;
  shortSummary: string | null;
  metrics: DailyDigestMetricsDomain;
  sources: DailyDigestSourcesDomain;
  llmTaskRouteId: string | null;
  deliveredAt: Date | null;
  createdAt: Date;
  eventsToday: DailyDigestEventDomain[];
  urgentItems: DailyDigestUrgentItemDomain[];
  whoShined: DailyDigestPersonShinedDomain[];
  whoStruggled: DailyDigestPersonStruggledDomain[];
  customersAtRisk: DailyDigestCustomerAtRiskDomain[];
  chronicBlockers: DailyDigestChronicBlockerDomain[];
  trend: DailyDigestTrendPointApi[];
}

export function fromDailyDigestApi(dto: DailyDigestApi): DailyDigestDomain {
  return {
    id: dto.id,
    tenantId: dto.tenantId,
    dateLocal: dto.dateLocal,
    bodyMarkdown: dto.bodyMarkdown,
    shortSummary: dto.shortSummary ?? null,
    metrics: dto.metrics,
    sources: dto.sources,
    llmTaskRouteId: dto.llmTaskRouteId ?? null,
    deliveredAt: dto.deliveredAt ? new Date(dto.deliveredAt) : null,
    createdAt: new Date(dto.createdAt),
    eventsToday: dto.eventsToday ?? [],
    urgentItems: dto.urgentItems ?? [],
    whoShined: dto.whoShined ?? [],
    whoStruggled: dto.whoStruggled ?? [],
    customersAtRisk: dto.customersAtRisk ?? [],
    chronicBlockers: dto.chronicBlockers ?? [],
    trend: dto.trend ?? [],
  };
}
