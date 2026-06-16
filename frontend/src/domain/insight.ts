import type {
  InsightCauseCategoryApi,
  InsightDetailApi,
  InsightDynamicApi,
  InsightKindApi,
  InsightListItemApi,
  InsightSeverityApi,
  InsightStatusApi,
} from "@/api/insights.api";

export type InsightKind = InsightKindApi;
export type InsightSeverity = InsightSeverityApi;
export type InsightDynamic = InsightDynamicApi;
export type InsightStatus = InsightStatusApi;
export type InsightCauseCategory = InsightCauseCategoryApi;

export const INSIGHT_KIND_LABEL: Record<InsightKind, string> = {
  problem: "Проблема",
  risk: "Риск",
  blocker: "Блокер",
  inefficiency: "Неэффективность",
};

export const INSIGHT_SEVERITY_LABEL: Record<InsightSeverity, string> = {
  low: "низкая",
  medium: "средняя",
  high: "высокая",
  critical: "критическая",
};

export const INSIGHT_SEVERITY_TONE: Record<
  InsightSeverity,
  "neutral" | "info" | "warning" | "danger"
> = {
  low: "neutral",
  medium: "info",
  high: "warning",
  critical: "danger",
};

export const INSIGHT_DYNAMIC_LABEL: Record<InsightDynamic, string> = {
  growing: "растёт",
  stable: "стабильно",
  declining: "снижается",
  spike: "всплеск",
};

export const INSIGHT_DYNAMIC_TONE: Record<
  InsightDynamic,
  "danger" | "warning" | "neutral" | "success"
> = {
  spike: "danger",
  growing: "warning",
  stable: "neutral",
  declining: "success",
};

export const INSIGHT_STATUS_LABEL: Record<InsightStatus, string> = {
  active: "Активный",
  mitigating: "В работе",
  mitigated: "Решён",
  archived: "В архиве",
  false_alarm: "Ложная тревога",
};

export const INSIGHT_STATUS_TONE: Record<
  InsightStatus,
  "info" | "warning" | "success" | "neutral"
> = {
  active: "info",
  mitigating: "warning",
  mitigated: "success",
  archived: "neutral",
  false_alarm: "neutral",
};

export interface InsightListItem extends InsightListItemApi {
  causeCategory: InsightCauseCategory | null;
}

export interface InsightDetail extends InsightDetailApi {
  causeCategory: InsightCauseCategory | null;
}

export function mapInsightDetail(dto: InsightDetailApi): InsightDetail {
  return { ...dto, causeCategory: dto.causeCategory ?? null };
}
