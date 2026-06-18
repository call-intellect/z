import { apiClient } from "./api-client";

export type EntityTypeApi =
  | "person"
  | "customer"
  | "vendor"
  | "project"
  | "product"
  | "document"
  | "goal"
  | "event"
  | "topic"
  | "location"
  | "technology"
  | "metric"
  | "market"
  | "org_unit"
  | "client"
  | "custom";

export interface EntityItemApi {
  id: string;
  type: string;
  canonicalName: string;
  aliases: string[];
  mentionsCount: number;
  metadata: Record<string, unknown> | null;
}

export interface BlockSearchItemApi {
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
}

export interface ListEntitiesResultApi {
  items: EntityItemApi[];
  total: number;
  limit: number;
  offset: number;
}

export interface EntityDetailApi {
  entity: EntityItemApi;
  blocks: BlockSearchItemApi[];
  mergedIntoId?: string;
}

export interface EntityLinkItemApi {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  relationType: string;
  confidence: number;
  explanation: string;
  status: string;
  createdBy: string;
  createdAt: string;
  other: {
    entityId: string;
    type: string;
    canonicalName: string;
  };
}

export interface EntityLinksResultApi {
  outgoing: EntityLinkItemApi[];
  incoming: EntityLinkItemApi[];
}

export interface ListEntitiesRequest {
  type?: EntityTypeApi;
  q?: string;
  includeMerged?: boolean;
  limit?: number;
  offset?: number;
}

function qs(
  params: Record<string, string | number | boolean | undefined>,
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const entitiesApi = {
  list: (req: ListEntitiesRequest = {}) =>
    apiClient.get<ListEntitiesResultApi>(
      `/api/v1/knowledge/entities${qs(
        req as Record<string, string | number | boolean | undefined>,
      )}`,
    ),

  get: (id: string) =>
    apiClient.get<EntityDetailApi>(
      `/api/v1/knowledge/entities/${encodeURIComponent(id)}`,
    ),

  links: (id: string) =>
    apiClient.get<EntityLinksResultApi>(
      `/api/v1/knowledge/entities/${encodeURIComponent(id)}/links`,
    ),
};
