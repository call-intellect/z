import type {
  DecisionAlternativeApi,
  DecisionDetailApi,
  DecisionHistoryResponseApi,
  DecisionListItemApi,
  DecisionStatusApi,
  DecisionSupersedeChainResponseApi,
  DecisionVersionItemApi,
  TrustTierApi,
} from "@/api/decisions.api";

export type DecisionStatus = DecisionStatusApi;
export type TrustTier = TrustTierApi;

export const DECISION_STATUS_LABEL: Record<DecisionStatus, string> = {
  proposed: "Предложенное",
  approved: "Принятое",
  rejected: "Отклонённое",
  implemented: "Реализованное",
  cancelled: "Отменено",
  superseded: "Заменено",
  active: "Действующее",
  rolled_back: "Откатано",
};

export const DECISION_STATUS_TONE: Record<
  DecisionStatus,
  "neutral" | "success" | "warning" | "error" | "info"
> = {
  proposed: "info",
  approved: "success",
  rejected: "error",
  implemented: "success",
  cancelled: "neutral",
  superseded: "neutral",
  active: "success",
  rolled_back: "warning",
};

export interface DecisionAlternative {
  option: string;
  reasonRejected: string | null;
}

export interface DecisionListItem {
  id: string;
  statement: string;
  status: DecisionStatus;
  decidedByPersonIds: string[];
  decidedAt: Date | null;
  deadline: Date | null;
  supersedesId: string | null;
  affectsEntityIds: string[];
  confidence: number | null;
  trustTier: TrustTier;
  updatedAt: Date;
  createdAt: Date;
}

export interface DecisionDetail extends DecisionListItem {
  rationale: string | null;
  alternatives: DecisionAlternative[];
  sourceBlockIds: string[];
  personSubjectIds: string[];
  currentVersionId: string | null;
  validFrom: Date | null;
  validUntil: Date | null;
  actualOutcomes: string | null;
  dataClass: string;
}

export interface DecisionVersionItem {
  id: string;
  version: number;
  previousVersionId: string | null;
  payload: Record<string, unknown>;
  changeReason: string | null;
  createdAt: Date;
  createdByUserId: string | null;
}

export interface DecisionSupersedeChain {
  ancestors: DecisionListItem[];
  descendants: DecisionListItem[];
}

function parseDateOrNull(value: string | null): Date | null {
  return value ? new Date(value) : null;
}

export function mapDecisionListItem(
  dto: DecisionListItemApi,
): DecisionListItem {
  return {
    id: dto.id,
    statement: dto.statement,
    status: dto.status,
    decidedByPersonIds: dto.decidedByPersonIds,
    decidedAt: parseDateOrNull(dto.decidedAt),
    deadline: parseDateOrNull(dto.deadline),
    supersedesId: dto.supersedesId,
    affectsEntityIds: dto.affectsEntityIds,
    confidence: dto.confidence,
    trustTier: dto.trustTier ?? "human",
    updatedAt: new Date(dto.updatedAt),
    createdAt: new Date(dto.createdAt),
  };
}

export function mapDecisionDetail(dto: DecisionDetailApi): DecisionDetail {
  return {
    ...mapDecisionListItem(dto),
    rationale: dto.rationale,
    alternatives: dto.alternatives.map(
      (a: DecisionAlternativeApi): DecisionAlternative => ({
        option: a.option,
        reasonRejected: a.reasonRejected,
      }),
    ),
    sourceBlockIds: dto.sourceBlockIds,
    personSubjectIds: dto.personSubjectIds,
    currentVersionId: dto.currentVersionId,
    validFrom: parseDateOrNull(dto.validFrom),
    validUntil: parseDateOrNull(dto.validUntil),
    actualOutcomes: dto.actualOutcomes,
    dataClass: dto.dataClass,
  };
}

export function mapDecisionVersionItem(
  dto: DecisionVersionItemApi,
): DecisionVersionItem {
  return {
    id: dto.id,
    version: dto.version,
    previousVersionId: dto.previousVersionId,
    payload: dto.payload,
    changeReason: dto.changeReason,
    createdAt: new Date(dto.createdAt),
    createdByUserId: dto.createdByUserId,
  };
}

export function mapDecisionSupersedeChain(
  dto: DecisionSupersedeChainResponseApi,
): DecisionSupersedeChain {
  return {
    ancestors: dto.ancestors.map(mapDecisionListItem),
    descendants: dto.descendants.map(mapDecisionListItem),
  };
}
