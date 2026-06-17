import { apiClient } from "./api-client";

export type ProcessTemplateStatusApi = "active" | "deprecated" | "archived";
export type ProcessTemplateVersionSourceApi = "manual" | "agent" | "imported";
export type ProcessHandoffKindApi =
  | "document"
  | "data"
  | "decision"
  | "physical"
  | "notification";

export interface ProcessTemplateStepApi {
  name: string;
  description?: string;
  order: number;
  ownerRoleId?: string;
  inputArtifact?: string;
  outputArtifact?: string;
  slaMinutes?: number;
}

export interface ProcessTemplateDefinitionApi {
  steps: ProcessTemplateStepApi[];
  handoffsInline: Array<{
    fromStepOrder?: number;
    toStepOrder?: number;
    kind: ProcessHandoffKindApi;
    payloadDescription?: string;
  }>;
  decisionPointsInline: Array<{
    name: string;
    condition?: string;
    afterStepOrder?: number;
  }>;
}

export interface ProcessTemplateListItemApi {
  id: string;
  name: string;
  summary: string | null;
  category: string | null;
  scope: string | null;
  status: ProcessTemplateStatusApi;
  currentVersionId: string | null;
  ownerRoleId: string | null;
  ownerPersonId: string | null;
  completeness: number;
  stepsCount: number;
  decisionPointsCount: number;
  handoffsCount: number;
  lastConfirmedAt: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface ProcessTemplateVersionApi {
  id: string;
  version: number;
  definition: ProcessTemplateDefinitionApi;
  source: ProcessTemplateVersionSourceApi;
  changeNote: string | null;
  publishedById: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export interface DecisionPointApi {
  id: string;
  templateId: string | null;
  name: string;
  condition: string | null;
  branches: Array<{
    name: string;
    description?: string;
    leadsToStepOrder?: number;
  }>;
  decidedByRoleId: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessHandoffApi {
  id: string;
  fromTemplateId: string | null;
  toTemplateId: string | null;
  fromRoleId: string | null;
  toRoleId: string | null;
  kind: ProcessHandoffKindApi;
  payloadDescription: string | null;
  expectedSlaHours: number | null;
  knownFrictionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessTemplateDetailApi extends ProcessTemplateListItemApi {
  sourceBlockIds: string[];
  currentVersion: ProcessTemplateVersionApi | null;
  decisionPoints: DecisionPointApi[];
  handoffsFrom: ProcessHandoffApi[];
  handoffsTo: ProcessHandoffApi[];
}

export interface ListProcessTemplatesResponseApi {
  items: ProcessTemplateListItemApi[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ListProcessTemplateVersionsResponseApi {
  items: ProcessTemplateVersionApi[];
}

export type ListProcessTemplatesRequest = {
  q?: string;
  status?: ProcessTemplateStatusApi;
  ownerEntityId?: string;
  completenessMin?: number;
  category?: string;
  page?: number;
  limit?: number;
};

function buildQuery(filters?: ListProcessTemplatesRequest): string {
  if (!filters) return "";
  const p = new URLSearchParams();
  if (filters.page) p.set("page", String(filters.page));
  if (filters.limit) p.set("limit", String(filters.limit));
  if (filters.status) p.set("status", filters.status);
  if (filters.ownerEntityId) p.set("ownerEntityId", filters.ownerEntityId);
  if (filters.completenessMin != null)
    p.set("completenessMin", String(filters.completenessMin));
  if (filters.category) p.set("category", filters.category);
  if (filters.q) p.set("q", filters.q);
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

export const processesApi = {
  list: (filters?: ListProcessTemplatesRequest) =>
    apiClient.get<ListProcessTemplatesResponseApi>(
      `/api/v1/processes/templates${buildQuery(filters)}`,
    ),
  get: (id: string) =>
    apiClient.get<ProcessTemplateDetailApi>(
      `/api/v1/processes/templates/${encodeURIComponent(id)}`,
    ),
  create: (body: {
    name: string;
    summary?: string;
    category?: string;
    scope?: string;
    ownerRoleId?: string;
    ownerPersonId?: string;
  }) =>
    apiClient.post<ProcessTemplateDetailApi>(
      `/api/v1/processes/templates`,
      body,
    ),
  update: (
    id: string,
    body: {
      name?: string;
      summary?: string;
      category?: string;
      scope?: string;
      ownerRoleId?: string | null;
      ownerPersonId?: string | null;
      status?: ProcessTemplateStatusApi;
    },
  ) =>
    apiClient.patch<ProcessTemplateDetailApi>(
      `/api/v1/processes/templates/${encodeURIComponent(id)}`,
      body,
    ),
  remove: (id: string) =>
    apiClient.del<{ ok: true }>(
      `/api/v1/processes/templates/${encodeURIComponent(id)}`,
    ),

  listVersions: (id: string) =>
    apiClient.get<ListProcessTemplateVersionsResponseApi>(
      `/api/v1/processes/templates/${encodeURIComponent(id)}/versions`,
    ),
  createVersion: (
    id: string,
    body: {
      definition: ProcessTemplateDefinitionApi;
      source?: ProcessTemplateVersionSourceApi;
      changeNote?: string;
      activateImmediately?: boolean;
    },
  ) =>
    apiClient.post<ProcessTemplateVersionApi>(
      `/api/v1/processes/templates/${encodeURIComponent(id)}/versions`,
      body,
    ),
  activateVersion: (id: string, versionId: string) =>
    apiClient.post<ProcessTemplateVersionApi>(
      `/api/v1/processes/templates/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/activate`,
      {},
    ),

  listDecisionPoints: (filters?: {
    templateId?: string;
    page?: number;
    limit?: number;
  }) => {
    const p = new URLSearchParams();
    if (filters?.templateId) p.set("templateId", filters.templateId);
    if (filters?.page) p.set("page", String(filters.page));
    if (filters?.limit) p.set("limit", String(filters.limit));
    const qs = p.toString();
    return apiClient.get<{ items: DecisionPointApi[]; total: number }>(
      `/api/v1/processes/decision-points${qs ? `?${qs}` : ""}`,
    );
  },

  listHandoffs: (filters?: {
    sourceTemplateId?: string;
    targetTemplateId?: string;
    kind?: ProcessHandoffKindApi;
    page?: number;
    limit?: number;
  }) => {
    const p = new URLSearchParams();
    if (filters?.sourceTemplateId)
      p.set("sourceTemplateId", filters.sourceTemplateId);
    if (filters?.targetTemplateId)
      p.set("targetTemplateId", filters.targetTemplateId);
    if (filters?.kind) p.set("kind", filters.kind);
    if (filters?.page) p.set("page", String(filters.page));
    if (filters?.limit) p.set("limit", String(filters.limit));
    const qs = p.toString();
    return apiClient.get<{ items: ProcessHandoffApi[]; total: number }>(
      `/api/v1/processes/handoffs${qs ? `?${qs}` : ""}`,
    );
  },

  extract: (body: { blockIds: string[] }) =>
    apiClient.post<{
      ok: true;
      enqueuedJobId: string;
      blockIdsCount: number;
    }>(`/api/v1/processes/extract`, body),
};

export type CrossFunctionalSeverityApi = "low" | "medium" | "high";

export interface CrossFunctionalProcessListItemApi {
  id: string;
  name: string;
  summary: string | null;
  category: string | null;
  scope: string | null;
  status: string;
  isCrossFunctional: boolean;
  crossFunctionalScore: number | null;
  activeFrictionCount: number;
  updatedAt: string;
  createdAt: string;
}

export interface ListCrossFunctionalProcessesResponseApi {
  items: CrossFunctionalProcessListItemApi[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CrossFunctionalFrictionReportApi {
  id: string;
  processTemplateId: string;
  severity: CrossFunctionalSeverityApi;
  description: string;
  sourceBlockIds: string[];
  involvedDepartmentIds: string[];
  recommendedAction: string | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListCrossFunctionalFrictionResponseApi {
  items: CrossFunctionalFrictionReportApi[];
}

export const crossFunctionalApi = {
  list: (filters?: { q?: string; page?: number; limit?: number }) => {
    const p = new URLSearchParams();
    if (filters?.q) p.set("q", filters.q);
    if (filters?.page) p.set("page", String(filters.page));
    if (filters?.limit) p.set("limit", String(filters.limit));
    const qs = p.toString();
    return apiClient.get<ListCrossFunctionalProcessesResponseApi>(
      `/api/v1/processes/cross-functional${qs ? `?${qs}` : ""}`,
    );
  },
  listFriction: (id: string, opts?: { includeResolved?: boolean }) => {
    const p = new URLSearchParams();
    if (opts?.includeResolved) p.set("includeResolved", "true");
    const qs = p.toString();
    return apiClient.get<ListCrossFunctionalFrictionResponseApi>(
      `/api/v1/processes/cross-functional/${encodeURIComponent(id)}/friction${qs ? `?${qs}` : ""}`,
    );
  },
  resolveFriction: (id: string, body?: { closingNote?: string }) =>
    apiClient.post<CrossFunctionalFrictionReportApi>(
      `/api/v1/processes/cross-functional/friction/${encodeURIComponent(id)}/resolve`,
      body ?? {},
    ),
};
