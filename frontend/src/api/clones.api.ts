/**
 * SBA γ-1 — API-клиент Clone API.
 *
 * Эндпоинты:
 *   - POST /api/v1/clones/roles/:roleId/ask  (ролевые клоны, фаза 3 ТЗ Clones=Roles)
 *
 * Фаза 3 ТЗ Clones=Roles (2026-05-25): `askPerson` удалён — клоны теперь
 * принадлежат ролям, а не персонам. Endpoint `/persons/:id/ask` будет
 * переименован в фазе 6 ТЗ; на γ-1 в frontend он больше не вызывается.
 *
 * Защита: `CookieAuthGuard + TenantGuard`. RBAC — внутри ClonesService
 * (owner/admin/self/direct manager). Rate limit — 20 в сутки на пользователя.
 */

import { apiClient } from './api-client';
import { orgHeaders } from './admin-helpers';

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
  mode: 'clone_style';
  /** true — носитель спрашивает своего же клона. */
  isOwner: boolean;
}

export interface AskCloneRequestApi {
  question: string;
  conversationId?: string;
}

export interface SkillTraitApi {
  id: string;
  category: string;
  statement: string;
  confidence: 'low' | 'medium' | 'high';
  observationCount: number;
  sourceBlockIds: string[];
  firstObservedAt: string;
  lastConfirmedAt: string;
  status: 'active' | 'superseded_by' | 'archived' | 'misleading';
}

export interface SkillProfileApi {
  profileId: string;
  personId: string;
  personName: string;
  status: 'active' | 'archived' | 'paused_relationship';
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
    status: 'active' | 'superseded';
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

// ─────────────── SBA γ-1 доделки — SkillTraitCategory + manual snapshot ───────────────

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

export const clonesApi = {
  // Фаза 3 ТЗ Clones=Roles (2026-05-25): `askPerson` удалён — клоны ролевые.
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

  /** SBA γ-1 доделки — manual snapshot ExecutablePersona. */
  triggerManualPersonaSnapshot: (orgId: string, personId: string) =>
    apiClient.post<ManualPersonaSnapshotResultApi>(
      `/api/v1/clones/persons/${encodeURIComponent(personId)}/persona/snapshot`,
      {},
      { headers: orgHeaders(orgId) },
    ),
};

/**
 * SBA γ-1 доделки — клиент для эмерджентных категорий SkillTrait.
 */
export const skillTraitCategoriesApi = {
  list: (
    orgId: string,
    params?: { parentCategoryId?: string; includeDeleted?: boolean },
  ) => {
    const search = new URLSearchParams();
    if (params?.parentCategoryId)
      search.set('parentCategoryId', params.parentCategoryId);
    if (params?.includeDeleted) search.set('includeDeleted', 'true');
    const qs = search.toString();
    return apiClient.get<{ items: SkillTraitCategoryApi[]; total: number }>(
      `/api/v1/skills/categories${qs ? `?${qs}` : ''}`,
      { headers: orgHeaders(orgId) },
    );
  },

  byId: (orgId: string, id: string) =>
    apiClient.get<SkillTraitCategoryApi>(
      `/api/v1/skills/categories/${encodeURIComponent(id)}`,
      { headers: orgHeaders(orgId) },
    ),

  create: (orgId: string, body: CreateSkillTraitCategoryBody) =>
    apiClient.post<SkillTraitCategoryApi>(
      `/api/v1/skills/categories`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  update: (orgId: string, id: string, body: UpdateSkillTraitCategoryBody) =>
    apiClient.patch<SkillTraitCategoryApi>(
      `/api/v1/skills/categories/${encodeURIComponent(id)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  remove: (orgId: string, id: string) =>
    apiClient.del<{ id: string; deletedAt: string }>(
      `/api/v1/skills/categories/${encodeURIComponent(id)}`,
      { headers: orgHeaders(orgId) },
    ),

  merge: (orgId: string, body: { sourceId: string; targetId: string }) =>
    apiClient.post<MergeSkillTraitCategoriesResultApi>(
      `/api/v1/skills/categories/merge`,
      body,
      { headers: orgHeaders(orgId) },
    ),
};
