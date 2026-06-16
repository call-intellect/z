import { apiClient } from "./api-client";
import { buildQuery, orgHeaders } from "./admin-helpers";

export interface EntityGraphNodeApi {
  id: string;
  type: "entity";
  entityType: string;
  name: string;
  depth: number;
}

export interface EntityGraphEvidenceApi {
  blockId: string;
  blockName: string;
  quote: string;
  sourceTimestamp: string | null;
}

export interface EntityGraphEdgeApi {
  edgeId: string;
  from: string;
  to: string;
  relationType: string;
  confidence: number;
  attributes: Record<string, unknown> | null;
  validFrom: string;
  validUntil: string | null;
  evidence: EntityGraphEvidenceApi[];
}

export interface EntityGraphResultApi {
  center: {
    id: string;
    type: "entity";
    entityType: string;
    name: string;
  };
  nodes: EntityGraphNodeApi[];
  edges: EntityGraphEdgeApi[];
  truncated: boolean;
}

export interface GetEntityGraphRequestApi {
  depth?: number;
}

export interface MarkEntityWrongRequestApi {
  edgeId?: string;
  nodeId?: string;
  reason?: string;
  taskType?: string;
}

export interface MarkEntityWrongResponseApi {
  ok: true;
  curationItemId: string;
  curationDecisionId: string;
}

export const entitiesGraphApi = {
  getGraph: (
    orgId: string,
    entityId: string,
    req: GetEntityGraphRequestApi = {},
  ) =>
    apiClient.get<EntityGraphResultApi>(
      `/api/v1/knowledge/entities/${encodeURIComponent(entityId)}/graph${buildQuery({ depth: req.depth })}`,
      { headers: orgHeaders(orgId) },
    ),

  markWrong: (
    orgId: string,
    entityId: string,
    body: MarkEntityWrongRequestApi,
  ) =>
    apiClient.post<MarkEntityWrongResponseApi>(
      `/api/v1/knowledge/entities/${encodeURIComponent(entityId)}/mark-wrong`,
      body,
      { headers: orgHeaders(orgId) },
    ),
};
