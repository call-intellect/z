/**
 * API-клиент для модулей структуры компании Фазы 0c:
 *   - departments (CRUD)
 *   - roles-domain (CRUD; «должности» Фазы 0, не путать с Membership.role)
 *   - persons-domain (CRUD сотрудников Org; не путать с knowledge entity `person`)
 *   - structure summary (виджет «Структура компании»)
 *   - role-profiles (карта должности из 0d)
 *   - me/profile (личный кабинет /me)
 *
 * Источник правды — backend API группы А (sub-TZ 0a/0d). На момент 0c часть
 * endpoint'ов может быть ещё не готова: ApiClient в этом случае вернёт
 * `http_404` / `forbidden` / `network_error` — UI обрабатывает graceful.
 */

import { apiClient } from './api-client';
import { buildQuery, orgHeaders } from './admin-helpers';

// ─── Department ─────────────────────────────────────────────────────────────

export interface DepartmentApi {
  id: string;
  orgId: string;
  name: string;
  /**
   * ТЗ 2026-05-25 «clone-reliability-hardening» Фаза 3 — глава отдела.
   * Person.id главы либо null. Probe-уведомления специалистов клона идут
   * сначала ему, и только при null — admin/owner Org.
   */
  headPersonId?: string | null;
  rolesCount?: number;
  personsCount?: number;
  createdAt: string;
}

export interface ListDepartmentsResponseApi {
  items: DepartmentApi[];
}

export interface CreateDepartmentRequest {
  name: string;
}

export interface UpdateDepartmentRequest {
  name?: string;
}

/** ТЗ 2026-05-25 Фаза 3 — body для PATCH /api/v1/departments/:id/head. */
export interface SetDepartmentHeadRequest {
  /** Person.id главы отдела или null чтобы снять. */
  headPersonId: string | null;
}

// ─── Role (бизнес-должность) ────────────────────────────────────────────────

export interface RoleDomainApi {
  id: string;
  orgId: string;
  name: string;
  departmentId: string | null;
  departmentName?: string | null;
  personsCount?: number;
  /** Статус карты должности (RoleProfile) — может отсутствовать. */
  profileStatus?: 'ready' | 'forming' | 'stale' | 'error' | 'absent' | null;
  hasJobDescription?: boolean;
  createdAt: string;
}

export interface ListRolesResponseApi {
  items: RoleDomainApi[];
}

export interface CreateRoleRequest {
  name: string;
  departmentId?: string | null;
}

export interface UpdateRoleRequest {
  name?: string;
  departmentId?: string | null;
}

export interface ListRolesQuery {
  departmentId?: string;
}

// ─── Person (сотрудник Org) ─────────────────────────────────────────────────

export interface PersonDomainApi {
  id: string;
  orgId: string;
  fullName: string;
  email: string | null;
  roleId: string | null;
  roleName?: string | null;
  departmentId: string | null;
  departmentName?: string | null;
  userId: string | null;
  invitationStatus: 'none' | 'pending' | 'accepted' | 'revoked' | 'expired';
  createdAt: string;
}

export interface ListPersonsResponseApi {
  items: PersonDomainApi[];
  total?: number;
}

export interface CreatePersonRequest {
  fullName: string;
  email?: string;
  roleId?: string | null;
  departmentId?: string | null;
  /** ТЗ «Команда + доступы» Фаза 2 — привязать карточку к участнику без Person. */
  linkUserId?: string | null;
}

// ─── Team roster (объединённый список раздела «Команда») ───
export interface TeamRosterItemApi {
  personId: string | null;
  userId: string | null;
  fullName: string;
  email: string | null;
  roleId: string | null;
  roleName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  invitationStatus: 'none' | 'pending' | 'accepted' | 'revoked' | 'expired';
  invitationId: string | null;
  systemRole:
    | 'owner'
    | 'admin'
    | 'manager'
    | 'coo'
    | 'hr_partner'
    | 'demo_observer'
    | null;
  telegramLinked: boolean;
  hasPersonCard: boolean;
}

export interface UpdatePersonRequest {
  fullName?: string;
  email?: string;
  roleId?: string | null;
  departmentId?: string | null;
}

export interface ListPersonsQuery {
  departmentId?: string;
  roleId?: string;
  invitationStatus?: PersonDomainApi['invitationStatus'];
}

// ─── Structure summary ──────────────────────────────────────────────────────

export interface StructureSummaryApi {
  departments: number;
  roles: number;
  persons: number;
  documents: number;
  roleProfiles: {
    total: number;
    ready: number;
    forming: number;
  };
}

// ─── Role-profile (карта должности) ─────────────────────────────────────────

export interface RoleProfileBlockApi {
  /** один из: responsibilities | skills | decision_patterns | common_pitfalls | style_profile */
  key: string;
  title?: string;
  items: string[];
}

export interface RoleProfileApi {
  roleId: string;
  status: 'ready' | 'forming' | 'stale' | 'error' | 'absent';
  summaryCache: {
    blocks: RoleProfileBlockApi[];
  } | null;
  sources?: Array<{
    type: 'meeting' | 'document' | 'dump';
    id: string;
    title: string;
  }>;
  updatedAt: string | null;
  /** Кол-во материалов в обработке (для UI «N материалов ждут анализа»). */
  pending?: number;
}

export interface RoleProfileBuildStatusApi {
  status: 'idle' | 'queued' | 'running';
  since?: string | null;
}

// ─── /me/profile ────────────────────────────────────────────────────────────

export interface MyProfileApi {
  person: PersonDomainApi | null;
  role: RoleDomainApi | null;
  department: DepartmentApi | null;
  roleProfile: RoleProfileApi | null;
}

// ─── API surface ────────────────────────────────────────────────────────────

export const departmentsApi = {
  list: (orgId: string) =>
    apiClient.get<ListDepartmentsResponseApi>('/api/v1/departments', {
      headers: orgHeaders(orgId),
    }),

  create: (orgId: string, body: CreateDepartmentRequest) =>
    apiClient.post<{ department: DepartmentApi }>(
      '/api/v1/departments',
      body,
      { headers: orgHeaders(orgId) },
    ),

  update: (orgId: string, id: string, body: UpdateDepartmentRequest) =>
    apiClient.patch<{ department: DepartmentApi }>(
      `/api/v1/departments/${encodeURIComponent(id)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  remove: (orgId: string, id: string) =>
    apiClient.del<{ ok: true }>(
      `/api/v1/departments/${encodeURIComponent(id)}`,
      { headers: orgHeaders(orgId) },
    ),

  /** ТЗ 2026-05-25 Фаза 3 — назначить/снять главу отдела. */
  setHead: (orgId: string, id: string, body: SetDepartmentHeadRequest) =>
    apiClient.patch<DepartmentApi>(
      `/api/v1/departments/${encodeURIComponent(id)}/head`,
      body,
      { headers: orgHeaders(orgId) },
    ),
};

export const rolesDomainApi = {
  list: (orgId: string, query: ListRolesQuery = {}) =>
    apiClient.get<ListRolesResponseApi>(
      `/api/v1/roles${buildQuery({ ...query })}`,
      { headers: orgHeaders(orgId) },
    ),

  byId: (orgId: string, id: string) =>
    apiClient.get<{ role: RoleDomainApi }>(
      `/api/v1/roles/${encodeURIComponent(id)}`,
      { headers: orgHeaders(orgId) },
    ),

  create: (orgId: string, body: CreateRoleRequest) =>
    apiClient.post<{ role: RoleDomainApi }>('/api/v1/roles', body, {
      headers: orgHeaders(orgId),
    }),

  update: (orgId: string, id: string, body: UpdateRoleRequest) =>
    apiClient.patch<{ role: RoleDomainApi }>(
      `/api/v1/roles/${encodeURIComponent(id)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  remove: (orgId: string, id: string) =>
    apiClient.del<{ ok: true }>(
      `/api/v1/roles/${encodeURIComponent(id)}`,
      { headers: orgHeaders(orgId) },
    ),
};

/**
 * Сырой ответ бэка `/api/v1/persons` (PersonListItemDto). Поля `name` /
 * `primaryDepartmentId` / `currentRoleId` НЕ совпадают с UI-моделью
 * PersonDomainApi (`fullName` / `departmentId` / `roleId`) — у read-методов
 * раньше не было обратного маппера (пустые имена в 5 поверхностях). Маппим
 * здесь, в api-слое (ApiDto→DomainModel), зеркало write-маппера create/update.
 */
interface PersonListItemApi {
  id: string;
  name: string | null;
  email: string | null;
  userId: string | null;
  primaryDepartmentId: string | null;
  primaryDepartmentName: string | null;
  currentRoleId: string | null;
  currentRoleName: string | null;
  invitationStatus: PersonDomainApi['invitationStatus'];
  createdAt: string;
}

function mapPersonFromApi(raw: PersonListItemApi, orgId: string): PersonDomainApi {
  return {
    id: raw.id,
    orgId,
    fullName: raw.name ?? '',
    email: raw.email,
    roleId: raw.currentRoleId,
    roleName: raw.currentRoleName,
    departmentId: raw.primaryDepartmentId,
    departmentName: raw.primaryDepartmentName,
    userId: raw.userId,
    invitationStatus: raw.invitationStatus,
    createdAt: raw.createdAt,
  };
}

export const personsDomainApi = {
  list: (orgId: string, query: ListPersonsQuery = {}): Promise<ListPersonsResponseApi> =>
    apiClient
      .get<{ items: PersonListItemApi[]; total?: number }>(
        `/api/v1/persons${buildQuery({ ...query })}`,
        { headers: orgHeaders(orgId) },
      )
      .then((r) => ({
        items: r.items.map((p) => mapPersonFromApi(p, orgId)),
        total: r.total,
      })),

  byId: (orgId: string, id: string): Promise<{ person: PersonDomainApi }> =>
    apiClient
      .get<{ person: PersonListItemApi }>(
        `/api/v1/persons/${encodeURIComponent(id)}`,
        { headers: orgHeaders(orgId) },
      )
      .then((r) => ({ person: mapPersonFromApi(r.person, orgId) })),

  // Бэкенд-контракт: { name, email, primaryDepartmentId, roleId } (CreatePersonSchema).
  // UI-модель использует fullName/departmentId — мапим имена полей здесь.
  create: (orgId: string, body: CreatePersonRequest) =>
    apiClient.post<{ person: PersonDomainApi }>(
      '/api/v1/persons',
      {
        name: body.fullName,
        email: body.email,
        primaryDepartmentId: body.departmentId ?? null,
        roleId: body.roleId ?? null,
        ...(body.linkUserId ? { linkUserId: body.linkUserId } : {}),
      },
      { headers: orgHeaders(orgId) },
    ),

  update: (orgId: string, id: string, body: UpdatePersonRequest) =>
    apiClient.patch<{ person: PersonDomainApi }>(
      `/api/v1/persons/${encodeURIComponent(id)}`,
      {
        ...(body.fullName !== undefined ? { name: body.fullName } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.departmentId !== undefined
          ? { primaryDepartmentId: body.departmentId }
          : {}),
        ...(body.roleId !== undefined ? { roleId: body.roleId } : {}),
      },
      { headers: orgHeaders(orgId) },
    ),

  remove: (orgId: string, id: string) =>
    apiClient.del<{ ok: true }>(
      `/api/v1/persons/${encodeURIComponent(id)}`,
      { headers: orgHeaders(orgId) },
    ),

  invite: (orgId: string, personId: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/orgs/${encodeURIComponent(orgId)}/invitations`,
      { personId },
      { headers: orgHeaders(orgId) },
    ),
};

export const teamRosterApi = {
  list: (orgId: string) =>
    apiClient.get<{ roster: TeamRosterItemApi[] }>(
      `/api/v1/orgs/${encodeURIComponent(orgId)}/team-roster`,
      { headers: orgHeaders(orgId) },
    ),
};

export const structureApi = {
  summary: (orgId: string) =>
    apiClient.get<StructureSummaryApi>('/api/v1/structure/summary', {
      headers: orgHeaders(orgId),
    }),
};

export const roleProfilesApi = {
  byRole: (orgId: string, roleId: string) =>
    apiClient.get<RoleProfileApi>(
      `/api/v1/role-profiles/${encodeURIComponent(roleId)}`,
      { headers: orgHeaders(orgId) },
    ),

  rebuild: (orgId: string, roleId: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/role-profiles/${encodeURIComponent(roleId)}/rebuild`,
      undefined,
      { headers: orgHeaders(orgId) },
    ),

  buildStatus: (orgId: string, roleId: string) =>
    apiClient.get<RoleProfileBuildStatusApi>(
      `/api/v1/role-profiles/${encodeURIComponent(roleId)}/build-status`,
      { headers: orgHeaders(orgId) },
    ),
};

export const meProfileApi = {
  get: (orgId: string) =>
    apiClient.get<MyProfileApi>('/api/v1/me/profile', {
      headers: orgHeaders(orgId),
    }),
};
