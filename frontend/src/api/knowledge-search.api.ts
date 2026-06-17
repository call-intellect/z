import { apiClient } from "./api-client";
import { orgHeaders } from "./admin-helpers";

export type KnowledgeSearchRequest = {
  query: string;
  signalTypes?: string[];
  entityIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
};

export type KnowledgeBlockApi = {
  id: string;
  name: string;
  criticalQuestion: string;
  trustedAnswer: string;
  signalType: string;
  tags: string[];
  confidence: number;
  evidenceCount: number;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeEvidenceApi = {
  id: string;
  rawEventId: string;
  sourceType: string;
  sourceTimestamp: string | null;
  quote: string;
  startMs: number | null;
  endMs: number | null;
};

export type KnowledgeEntityApi = {
  id: string;
  type: string;
  canonicalName: string;
  aliases: string[];
  mentionsCount: number;
  metadata: Record<string, unknown> | null;
};

export type KnowledgeSearchResultItemApi = {
  block: KnowledgeBlockApi;
  evidence: KnowledgeEvidenceApi[];
  entities: KnowledgeEntityApi[];
  scores: {
    cosine: number;
    bm25: number;
    combined: number;
  };
};

export type KnowledgeSearchResponseApi = {
  results: KnowledgeSearchResultItemApi[];
  tookMs: number;
};

export const knowledgeSearchApi = {
  search: (orgId: string, body: KnowledgeSearchRequest) =>
    apiClient.post<KnowledgeSearchResponseApi>(
      "/api/v1/knowledge/search",
      body,
      { headers: orgHeaders(orgId) },
    ),
};
