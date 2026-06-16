import type {
  KnowledgeAtRiskItemApi,
  KnowledgeAtRiskListApi,
} from "@/api/operations-dashboard.api";

export type KnowledgeRiskSeverity = "critical" | "warning" | "ok";

export const KNOWLEDGE_RISK_SEVERITY_LABEL: Record<string, string> = {
  critical: "критично",
  warning: "внимание",
  ok: "в норме",
};

export interface KnowledgeAtRiskDomain {
  categoryName: string;
  soleExpertPersonName: string | null;
  combinedSeverity: string;
  snapshotAt: Date;
}

export function fromKnowledgeAtRiskApi(
  api: KnowledgeAtRiskListApi,
): KnowledgeAtRiskDomain[] {
  return api.items.map((i: KnowledgeAtRiskItemApi) => ({
    categoryName: i.categoryName,
    soleExpertPersonName: i.soleExpertPersonName,
    combinedSeverity: i.combinedSeverity,
    snapshotAt: new Date(i.snapshotAt),
  }));
}
