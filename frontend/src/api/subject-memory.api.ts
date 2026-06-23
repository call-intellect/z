import { apiClient } from "./api-client";
import { buildQuery } from "./admin-helpers";

export interface SubjectMemoryItemApi {
  id: string;
  kind: "term" | "disambiguation" | "preference";
  contextText: string;
  ruleText: string;
  status:
    | "shadow"
    | "canary"
    | "active"
    | "superseded"
    | "rolled_back"
    | "disabled";
  confidence: number;
  confirmCount: number;
  refuteCount: number;
  sourceProbeIds: string[];
  appliedCount: number;
  occurredAt: string;
  lastAppliedAt: string | null;
  createdAt: string;
}

export interface SubjectMemoryListApi {
  items: SubjectMemoryItemApi[];
  total: number;
  page: number;
  limit: number;
  countsByStatus: Record<string, number>;
}

export type SubjectMemoryQuery = {
  status?: string;
  kind?: string;
  limit?: number;
  page?: number;
};

export const subjectMemoryApi = {
  list: (q?: SubjectMemoryQuery) =>
    apiClient.get<SubjectMemoryListApi>(
      `/api/v1/subject-memory${buildQuery({ ...q })}`,
    ),
};
