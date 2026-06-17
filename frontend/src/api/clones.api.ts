import { apiClient } from "./api-client";
import { buildQuery, orgHeaders } from "./admin-helpers";

export interface CloneCitationApi {
  blockId: string;
  meetingId?: string;
  meetingTitle?: string;
  startMs?: number;
  endMs?: number;
  snippet?: string;
}

export interface AskCloneResponseApi {
  conversationId: string;
  messageId: string;
  text: string;
  citations: CloneCitationApi[];
  mode: "clone_style";
  isOwner: boolean;
  refused?: boolean;
  refusalReason?: string | null;
}

export interface AskCloneRequestApi {
  question: string;
  conversationId?: string;
  roleVersion?: number;
}

export interface SkillTraitApi {
  id: string;
  category: string;
  statement: string;
  confidence: "low" | "medium" | "high";
  observationCount: number;
  sourceBlockIds: string[];
  firstObservedAt: string;
  lastConfirmedAt: string;
  status: "active" | "superseded_by" | "archived" | "misleading";
}

export interface SkillProfileApi {
  profileId: string;
  personId: string;
  personName: string;
  status: "active" | "archived" | "paused_relationship";
  buildVersion: number;
  lastBuildAt: string | null;
  isEmpty: boolean;
  canMarkMisleading: boolean;
  isSelf: boolean;
  traits: SkillTraitApi[];
  personaSnapshots: Array<{
    id: string;
    version: number;
    snapshotAt: string;
    builtFromTraitsCount: number;
    status: "active" | "superseded";
  }>;
}

export interface RoleSkillProfileApi {
  roleId: string;
  roleName: string;
  topTraits: Array<{
    category: string;
    statement: string;
    observationCount: number;
  }>;
  people: Array<{
    personId: string;
    personName: string;
    activeTraitsCount: number;
    profileBuildVersion: number;
  }>;
  hasRolePersona: boolean;
}

export interface SkillTraitCategoryApi {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  description: string | null;
  parentCategoryId: string | null;
  traitsCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface MergeSkillTraitCategoriesResultApi {
  source: SkillTraitCategoryApi;
  target: SkillTraitCategoryApi;
  movedTraits: number;
}

export interface CreateSkillTraitCategoryBody {
  name: string;
  description?: string | null;
  parentCategoryId?: string | null;
}

export interface UpdateSkillTraitCategoryBody {
  name?: string;
  description?: string | null;
  parentCategoryId?: string | null;
}

export interface ManualPersonaSnapshotResultApi {
  built: boolean;
  personaId: string | null;
  reason: string | null;
}

export interface CloneListItemApi {
  personaId: string;
  roleId: string;
  roleName: string;
  departmentName: string | null;
  departmentId: string | null;
  version: number;
  publicName: string;
  status: "active" | "superseded" | "pending_rebuild";
  currentBearer: { personId: string; personName: string } | null;
  confidence: number;
  traitsCount: number;
  lastBuildAt: string;
}

export interface ClonesListResponseApi {
  items: CloneListItemApi[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ClonesListParams {
  status?: "active" | "superseded";
  q?: string;
  confidenceMin?: number;
  page?: number;
  pageSize?: number;
}

export interface CloneVersionApi {
  personaId: string;
  roleId: string;
  version: number;
  publicName: string;
  status: "active" | "superseded" | "pending_rebuild" | "frozen";
  bearer: { personId: string; personName: string } | null;
  validFrom: string;
  validUntil: string | null;
  confidence: number;
  traitsCount: number;
}

export interface CloneHistoryResponseApi {
  roleId: string;
  roleName: string;
  versions: CloneVersionApi[];
}

export interface AskFormerAnswerApi {
  personaId: string;
  version: number;
  publicName: string;
  status: "active" | "frozen";
  response: AskCloneResponseApi | null;
  error: string | null;
}

export interface AskAllFormersResponseApi {
  roleId: string;
  roleName: string;
  question: string;
  answers: AskFormerAnswerApi[];
}

export interface AskAllFormersRequestApi {
  question: string;
}

export interface CloneConversationListItemApi {
  id: string;
  title: string | null;
  lastMessageAt: string;
  messageCount: number;
  createdAt: string;
}

export interface CloneConversationsListResponseApi {
  items: CloneConversationListItemApi[];
  nextCursor: string | null;
}

export interface CloneConversationsListParams {
  cloneType: "role" | "person";
  cloneRefId: string;
  limit?: number;
  cursor?: string;
}

export interface CreateCloneConversationResponseApi {
  conversationId: string;
}

export const clonesApi = {
  askRole: (orgId: string, roleId: string, body: AskCloneRequestApi) =>
    apiClient.post<AskCloneResponseApi>(
      `/api/v1/clones/roles/${encodeURIComponent(roleId)}/ask`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  getPersonSkillProfile: (orgId: string, personId: string) =>
    apiClient.get<SkillProfileApi>(
      `/api/v1/clones/persons/${encodeURIComponent(personId)}/skill-profile`,
      { headers: orgHeaders(orgId) },
    ),

  getRoleSkillProfile: (orgId: string, roleId: string) =>
    apiClient.get<RoleSkillProfileApi>(
      `/api/v1/clones/roles/${encodeURIComponent(roleId)}/skill-profile`,
      { headers: orgHeaders(orgId) },
    ),

  markTraitMisleading: (
    orgId: string,
    traitId: string,
    body: { reason: string },
  ) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/clones/skill-traits/${encodeURIComponent(traitId)}/mark-misleading`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  triggerManualPersonaSnapshot: (orgId: string, personId: string) =>
    apiClient.post<ManualPersonaSnapshotResultApi>(
      `/api/v1/clones/persons/${encodeURIComponent(personId)}/persona/snapshot`,
      {},
      { headers: orgHeaders(orgId) },
    ),

  listClones: (orgId: string, params: ClonesListParams = {}) => {
    const qs = buildQuery({
      status: params.status,
      q: params.q,
      confidenceMin: params.confidenceMin,
      page: params.page,
      pageSize: params.pageSize,
    });
    return apiClient.get<ClonesListResponseApi>(`/api/v1/clones${qs}`, {
      headers: orgHeaders(orgId),
    });
  },

  getCloneHistory: (orgId: string, roleId: string) =>
    apiClient.get<CloneHistoryResponseApi>(
      `/api/v1/clones/${encodeURIComponent(roleId)}/history`,
      { headers: orgHeaders(orgId) },
    ),

  askAllFormers: (
    orgId: string,
    roleId: string,
    body: AskAllFormersRequestApi,
  ) =>
    apiClient.post<AskAllFormersResponseApi>(
      `/api/v1/clones/roles/${encodeURIComponent(roleId)}/ask-all-formers`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  createRoleConversation: (orgId: string, roleId: string) =>
    apiClient.post<CreateCloneConversationResponseApi>(
      `/api/v1/clones/roles/${encodeURIComponent(roleId)}/conversations`,
      {},
      { headers: orgHeaders(orgId) },
    ),

  createPersonConversation: (orgId: string, personId: string) =>
    apiClient.post<CreateCloneConversationResponseApi>(
      `/api/v1/clones/persons/${encodeURIComponent(personId)}/conversations`,
      {},
      { headers: orgHeaders(orgId) },
    ),

  listMyCloneConversations: (
    orgId: string,
    params: CloneConversationsListParams,
  ) => {
    const qs = buildQuery({
      cloneType: params.cloneType,
      cloneRefId: params.cloneRefId,
      limit: params.limit,
      cursor: params.cursor,
    });
    return apiClient.get<CloneConversationsListResponseApi>(
      `/api/v1/clones/conversations${qs}`,
      { headers: orgHeaders(orgId) },
    );
  },

  requestAccess: (
    orgId: string,
    cloneType: "role" | "person",
    cloneRefId: string,
  ) =>
    apiClient.post<{ ok: true } | { ok: false; reason: string }>(
      `/api/v1/clones/${cloneType}s/${encodeURIComponent(
        cloneRefId,
      )}/access-grants/request`,
      {},
      { headers: orgHeaders(orgId) },
    ),
};
