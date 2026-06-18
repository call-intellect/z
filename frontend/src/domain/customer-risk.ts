import type {
  CustomerRiskListApi,
  CustomerRiskSnapshotApi,
} from "@/api/operations-dashboard.api";

export type CustomerRiskLevel = "critical" | "warning" | "ok";

export const CUSTOMER_RISK_LEVEL_LABEL: Record<CustomerRiskLevel, string> = {
  critical: "критично",
  warning: "внимание",
  ok: "в норме",
};

export const CUSTOMER_RISK_SIGNAL_LABEL: Record<
  "churn_risk" | "objection" | "pain" | "feature_request",
  string
> = {
  churn_risk: "риск ухода",
  objection: "возражения",
  pain: "боль",
  feature_request: "запросы доработок",
};

export interface CustomerRiskDomain {
  id: string;
  customerName: string;
  riskLevel: CustomerRiskLevel;
  riskScore: number;
  scoreDelta: number;
  responsiblePersonName: string | null;
  hint: string;
  topSignalBadge: string | null;
}

function topSignalBadge(
  counts: CustomerRiskSnapshotApi["signalCounts"],
): string | null {
  const ranked = (
    ["churn_risk", "objection", "pain", "feature_request"] as const
  )
    .map((k) => ({ label: CUSTOMER_RISK_SIGNAL_LABEL[k], n: counts[k] ?? 0 }))
    .filter((e) => e.n > 0)
    .sort((a, b) => b.n - a.n);
  const top = ranked[0];
  return top ? `${top.label}: ${top.n}` : null;
}

export function fromCustomerRiskListApi(
  api: CustomerRiskListApi,
): CustomerRiskDomain[] {
  return api.items.map((c) => ({
    id: c.id,
    customerName: c.customerName,
    riskLevel: c.riskLevel,
    riskScore: c.riskScore,
    scoreDelta: c.scoreDelta,
    responsiblePersonName: c.responsiblePersonName,
    hint: c.hint,
    topSignalBadge: topSignalBadge(c.signalCounts),
  }));
}
