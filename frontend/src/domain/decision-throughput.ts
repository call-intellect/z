import type {
  DecisionThroughputApi,
  StalledDecisionApi,
  StalledDecisionsApi,
} from "@/api/operations-dashboard.api";
import { decisionProgressTone } from "./value-recap";

export interface DecisionThroughputDomain {
  total: number;
  doneWithOutcomes: number;
  throughputPercent: number;
  from: string;
  to: string;
  progressTone: "teal" | "warn" | "risk";
}

export function fromDecisionThroughputApi(
  api: DecisionThroughputApi,
): DecisionThroughputDomain {
  return {
    total: api.total,
    doneWithOutcomes: api.doneWithOutcomes,
    throughputPercent: api.throughputPercent,
    from: api.from,
    to: api.to,
    progressTone: decisionProgressTone(api.throughputPercent),
  };
}

export interface StalledDecisionDomain {
  id: string;
  statement: string;
  decidedAt: Date | null;
  ageDays: number;
}

export function fromStalledDecisionsApi(
  api: StalledDecisionsApi,
): StalledDecisionDomain[] {
  return api.items.map((d: StalledDecisionApi) => ({
    id: d.id,
    statement: d.statement,
    decidedAt: d.decidedAt ? new Date(d.decidedAt) : null,
    ageDays: d.ageDays,
  }));
}
