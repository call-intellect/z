import { apiClient } from "./api-client";
import type { PreviewSourceRefApi } from "@/domain/provenance";

export type DecisionStatusApi =
  | "proposed"
  | "approved"
  | "rejected"
  | "implemented"
  | "cancelled"
  | "superseded"
  | "active"
  | "rolled_back";

export type DeadlineFilterApi = "overdue" | "upcoming" | "all";

export type TrustTierApi = "auto" | "provisional" | "human";

export interface DecisionListItemApi {
  id: string;
  statement: string;
  status: DecisionStatusApi;
  decidedByPersonIds: string[];
  decidedAt: string | null;
  deadline: string | null;
  supersedesId: string | null;
  affectsEntityIds: string[];
  confidence: number | null;
  trustTier: TrustTierApi;
  previewQuote?: string | null;
  previewSourceRef?: PreviewSourceRefApi | null;
  updatedAt: string;
  createdAt: string;
}

export interface DecisionAlternativeApi {
  option: string;
  reasonRejected: string | null;
}

export interface DecisionDetailApi extends DecisionListItemApi {
  rationale: string | null;
  alternatives: DecisionAlternativeApi[];
  sourceBlockIds: string[];
  personSubjectIds: string[];
  currentVersionId: string | null;
  validFrom: string | null;
  validUntil: string | null;
  actualOutcomes: string | null;
  dataClass: string;
}

export interface DecisionsListResponseApi {
  items: DecisionListItemApi[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface DecisionVersionItemApi {
  id: string;
  version: number;
  previousVersionId: string | null;
  payload: Record<string, unknown>;
  changeReason: string | null;
  createdAt: string;
  createdByUserId: string | null;
}

export interface DecisionHistoryResponseApi {
  items: DecisionVersionItemApi[];
}

export interface DecisionSupersedeChainResponseApi {
  ancestors: DecisionListItemApi[];
  descendants: DecisionListItemApi[];
}

export type ListDecisionsRequest = {
  page?: number;
  limit?: number;
  status?: DecisionStatusApi;
  decided_by?: string;
  deadline_filter?: DeadlineFilterApi;
  affects_entity_id?: string;
  q?: string;
  deleted?: boolean;
};

function buildDecisionsQuery(filters?: ListDecisionsRequest): string {
  if (!filters) return "";
  const p = new URLSearchParams();
  if (filters.page) p.set("page", String(filters.page));
  if (filters.limit) p.set("limit", String(filters.limit));
  if (filters.status) p.set("status", filters.status);
  if (filters.decided_by) p.set("decided_by", filters.decided_by);
  if (filters.deadline_filter)
    p.set("deadline_filter", filters.deadline_filter);
  if (filters.affects_entity_id)
    p.set("affects_entity_id", filters.affects_entity_id);
  if (filters.q) p.set("q", filters.q);
  if (filters.deleted) p.set("deleted", "true");
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

export const decisionsApi = {
  list: (filters?: ListDecisionsRequest) =>
    apiClient.get<DecisionsListResponseApi>(
      `/api/v1/decisions${buildDecisionsQuery(filters)}`,
    ),

  get: (id: string) =>
    apiClient.get<DecisionDetailApi>(
      `/api/v1/decisions/${encodeURIComponent(id)}`,
    ),

  history: (id: string) =>
    apiClient.get<DecisionHistoryResponseApi>(
      `/api/v1/decisions/${encodeURIComponent(id)}/history`,
    ),

  supersedeChain: (id: string) =>
    apiClient.get<DecisionSupersedeChainResponseApi>(
      `/api/v1/decisions/${encodeURIComponent(id)}/supersede-chain`,
    ),

  supersede: (
    id: string,
    body: { supersededByDecisionId: string; supersedeReason?: string },
  ) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/decisions/${encodeURIComponent(id)}/supersede`,
      body,
    ),

  changeStatus: (
    id: string,
    body: { newStatus: DecisionStatusApi; reason?: string },
  ) =>
    apiClient.post<{ ok: true; status: DecisionStatusApi }>(
      `/api/v1/decisions/${encodeURIComponent(id)}/status`,
      body,
    ),

  setOutcomes: (id: string, body: { actualOutcomes: string }) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/decisions/${encodeURIComponent(id)}/outcomes`,
      body,
    ),

  dispute: (id: string, body: { reason?: string }) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/decisions/${encodeURIComponent(id)}/dispute`,
      body,
    ),

  correct: (
    id: string,
    body: {
      correctedPayload: { statement?: string; rationale?: string };
      reason?: string;
    },
  ) =>
    apiClient.post<{ ok: true; applied: boolean }>(
      `/api/v1/decisions/${encodeURIComponent(id)}/correct`,
      body,
    ),

  remove: (id: string) =>
    apiClient.del<void>(`/api/v1/decisions/${encodeURIComponent(id)}`),

  restore: (id: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/decisions/${encodeURIComponent(id)}/restore`,
    ),
};
