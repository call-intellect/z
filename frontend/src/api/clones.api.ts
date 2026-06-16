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
import { buildQuery, orgHeaders } from './admin-helpers';

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
  /**
   * Фаза 1 «clone reliability hardening» — клон отказался отвечать
   * (анти-deepfake). Может отсутствовать в старых ответах — трактуем как false.
   */
  refused?: boolean;
  /**
   * Машинно-читаемая причина отказа клона отвечать.
   * Известные коды: `'topic_starved'` — в архиве недостаточно обсуждений по теме.
   */
  refusalReason?: string | null;
}

export interface AskCloneRequestApi {
  question: string;
  conversationId?: string;
  /**
   * Раздел 7 (2026-06-16) — спросить КОНКРЕТНУЮ версию клона должности,
   * в т.ч. `frozen`-снимок бывшего носителя. Без поля — отвечает текущий
   * `active`-клон.
   */
  roleVersion?: number;
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

// ─────────── Clones=Roles Ф4 — list & history ───────────

export interface CloneListItemApi {
  personaId: string;
  roleId: string;
  roleName: string;
  departmentName: string | null;
  departmentId: string | null;
  version: number;
  publicName: string;
  /**
   * Clones=Roles Ф2 (2026-05-25) — добавлен `pending_rebuild`: после смены
   * носителя роли создаётся новая версия без personaPrompt; следующий
   * `executable-persona-build` его дозаполнит и переключит на `active`.
   */
  status: 'active' | 'superseded' | 'pending_rebuild';
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
  status?: 'active' | 'superseded';
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
  /**
   * Раздел 7 (2026-06-16) — добавлен `frozen`: снимок БЫВШЕГО носителя.
   * Замороженные версии доступны для вопросов навсегда («совет бывших»).
   */
  status: 'active' | 'superseded' | 'pending_rebuild' | 'frozen';
  /**
   * Раздел 7 (2026-06-16) — ФИО носителя больше НЕ приходит (всегда null).
   * UI показывает только publicName «Клон <Должность> v<N>».
   */
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

// ─────────── Раздел 7 (2026-06-16) — «Совет бывших» ───────────

/**
 * Один ответ конкретной версии клона на общий вопрос.
 * `response` = null при ошибке (тогда `error` заполнен).
 */
export interface AskFormerAnswerApi {
  personaId: string;
  version: number;
  publicName: string;
  status: 'active' | 'frozen';
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

// ─────────── ТЗ 2026-05-26 §2.7 + §9.4.7 — clone-conversations ───────────

/**
 * Один диалог пользователя с клоном из боковой панели.
 * Поля совпадают с backend `CloneConversationListItemDto`:
 *   - id            : ChatV2Conversation.id (UUID)
 *   - title         : null до первой LLM-генерации title'а
 *   - lastMessageAt : ISO (= ChatV2Conversation.updatedAt)
 *   - messageCount  : общее число сообщений
 *   - createdAt     : ISO
 */
export interface CloneConversationListItemApi {
  id: string;
  title: string | null;
  lastMessageAt: string;
  messageCount: number;
  createdAt: string;
}

export interface CloneConversationsListResponseApi {
  items: CloneConversationListItemApi[];
  /** id последнего элемента для следующей страницы или null если больше нет. */
  nextCursor: string | null;
}

export interface CloneConversationsListParams {
  cloneType: 'role' | 'person';
  cloneRefId: string;
  limit?: number;
  cursor?: string;
}

export interface CreateCloneConversationResponseApi {
  conversationId: string;
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

  /** Clones=Roles Ф4 — список текущих ролевых клонов Org. */
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

  /** Clones=Roles Ф4 — история версий клона роли. */
  getCloneHistory: (orgId: string, roleId: string) =>
    apiClient.get<CloneHistoryResponseApi>(
      `/api/v1/clones/${encodeURIComponent(roleId)}/history`,
      { headers: orgHeaders(orgId) },
    ),

  /**
   * Раздел 7 (2026-06-16) — «Совет бывших»: один вопрос → ответы всех версий
   * (active + frozen) клона должности рядом.
   * Backend: `POST /api/v1/clones/roles/:roleId/ask-all-formers`.
   */
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

  // ─────────── ТЗ 2026-05-26 §9.4.7 — «Новый диалог» ───────────

  /**
   * Создать новый пустой ChatV2Conversation с клоном роли.
   * Backend: `POST /api/v1/clones/roles/:roleId/conversations`.
   * Используется кнопкой «+ Новый диалог» в карточке клона и в sidebar.
   */
  createRoleConversation: (orgId: string, roleId: string) =>
    apiClient.post<CreateCloneConversationResponseApi>(
      `/api/v1/clones/roles/${encodeURIComponent(roleId)}/conversations`,
      {},
      { headers: orgHeaders(orgId) },
    ),

  /**
   * Создать новый пустой ChatV2Conversation с клоном персоны.
   * Backend: `POST /api/v1/clones/persons/:personId/conversations`.
   * В маркетплейсе member-view не используется (person-клоны не выставляются),
   * но клиент держим для admin-debug / Concierge.
   */
  createPersonConversation: (orgId: string, personId: string) =>
    apiClient.post<CreateCloneConversationResponseApi>(
      `/api/v1/clones/persons/${encodeURIComponent(personId)}/conversations`,
      {},
      { headers: orgHeaders(orgId) },
    ),

  // ─────────── ТЗ 2026-05-26 §2.7 — список диалогов member ───────────

  /**
   * Список диалогов текущего пользователя с конкретным клоном.
   * Backend: `GET /api/v1/clones/conversations?cloneType=role&cloneRefId=:id`.
   * Сортировка: lastMessageAt DESC. Cursor-based pagination.
   */
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

  /**
   * Запросить доступ к клону у админа (in-app сигнал).
   * audit В17 (2026-05-29) — backend endpoint реализован.
   * Возможные reason'ы при ok=false:
   *   - `already_granted` — у юзера уже есть активный grant на этот клон.
   *   - `no_admins` — в Org нет owner/admin (deg-кейс).
   *   - `role_not_found` / `person_not_found` — cloneRefId не существует.
   */
  requestAccess: (
    orgId: string,
    cloneType: 'role' | 'person',
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
