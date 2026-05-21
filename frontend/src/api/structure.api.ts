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

export const personsDomainApi = {
  list: (orgId: string, query: ListPersonsQuery = {}) =>
    apiClient.get<ListPersonsResponseApi>(
      `/api/v1/persons${buildQuery({ ...query })}`,
      { headers: orgHeaders(orgId) },
    ),

  byId: (orgId: string, id: string) =>
    apiClient.get<{ person: PersonDomainApi }>(
      `/api/v1/persons/${encodeURIComponent(id)}`,
      { headers: orgHeaders(orgId) },
    ),

  create: (orgId: string, body: CreatePersonRequest) =>
    apiClient.post<{ person: PersonDomainApi }>('/api/v1/persons', body, {
      headers: orgHeaders(orgId),
    }),

  update: (orgId: string, id: string, body: UpdatePersonRequest) =>
    apiClient.patch<{ person: PersonDomainApi }>(
      `/api/v1/persons/${encodeURIComponent(id)}`,
      body,
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
