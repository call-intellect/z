import { apiClient } from "./api-client";
import { buildQuery, orgHeaders } from "./admin-helpers";
import type { PersonPulseApi } from "@/domain/person-pulse";

export interface PersonEntityApi {
  id: string;
  type: string;
  canonicalName: string;
  aliases: string[];
  mentionsCount: number;
  metadata: Record<string, unknown> | null;
}

export interface PersonBlockApi {
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

export interface PersonDetailApi {
  entity: PersonEntityApi;
  blocks: PersonBlockApi[];
  mergedIntoId?: string;
}

export interface EraseReportApi {
  erasedRawEvents: number;
  deletedEvidences: number;
  archivedBlocks: number;
  deletedEntityLinks: number;
  alreadyErased?: boolean;
}

export interface ListPersonsResultApi {
  items: PersonEntityApi[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListPersonsRequest {
  q?: string;
  limit?: number;
  offset?: number;
}

export interface QuickCreatePersonRequestApi {
  name: string;
  email?: string;
  phone?: string;
}

export interface QuickCreatePersonResponseApi {
  personId: string;
  name: string;
  email: string | null;
}

export const personsApi = {
  list: (orgId: string, req: ListPersonsRequest = {}) =>
    apiClient.get<ListPersonsResultApi>(
      `/api/v1/knowledge/entities${buildQuery({ type: "person", ...req })}`,
      { headers: orgHeaders(orgId) },
    ),

  getEntity: (orgId: string, entityId: string) =>
    apiClient.get<PersonDetailApi>(
      `/api/v1/knowledge/entities/${encodeURIComponent(entityId)}`,
      { headers: orgHeaders(orgId) },
    ),

  eraseData: (orgId: string, entityId: string, reason: string) =>
    apiClient.del<EraseReportApi>(
      `/api/v1/persons/${encodeURIComponent(entityId)}/data`,
      {
        headers: orgHeaders(orgId),
        body: { reason },
      },
    ),

  quickCreate: (body: QuickCreatePersonRequestApi) =>
    apiClient.post<QuickCreatePersonResponseApi>(
      "/api/v1/persons/quick-create",
      body,
    ),

  getPulse: (orgId: string, personId: string) =>
    apiClient.get<PersonPulseApi>(
      `/api/v1/persons/${encodeURIComponent(personId)}/pulse`,
      { headers: orgHeaders(orgId) },
    ),
};
