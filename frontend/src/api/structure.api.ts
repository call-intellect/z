import { apiClient } from "./api-client";
import { buildQuery, orgHeaders } from "./admin-helpers";
import type { RoleMapApi } from "./role-map.api";

export interface DepartmentApi {
  id: string;
  orgId: string;
  name: string;
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

export interface SetDepartmentHeadRequest {
  headPersonId: string | null;
}

export interface MergeDepartmentResponse {
  ok: boolean;
  target: DepartmentApi;
  moved: {
    roles: number;
    persons: number;
    [key: string]: number;
  };
}

export interface RoleDomainApi {
  id: string;
  orgId: string;
  name: string;
  departmentId: string | null;
  departmentName?: string | null;
  personsCount?: number;
  profileStatus?: "ready" | "forming" | "stale" | "error" | "absent" | null;
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
  invitationStatus: "none" | "pending" | "accepted" | "revoked" | "expired";
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
  linkUserId?: string | null;
}

export interface TeamRosterItemApi {
  personId: string | null;
  userId: string | null;
  fullName: string;
  email: string | null;
  roleId: string | null;
  roleName: string | null;
  relationship: "employee" | "external" | "candidate" | "former";
  departmentId: string | null;
  departmentName: string | null;
  invitationStatus: "none" | "pending" | "accepted" | "revoked" | "expired";
  invitationId: string | null;
  systemRole:
    | "owner"
    | "admin"
    | "manager"
    | "coo"
    | "hr_partner"
    | "demo_observer"
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
  relationship?: "employee" | "external" | "candidate" | "former";
  invitationStatus?: PersonDomainApi["invitationStatus"];
}

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

export interface RoleProfileApi {
  roleId: string;
  status: "ready" | "forming" | "stale" | "error" | "absent";
  summary?: unknown;
  sources?: Array<{
    type: "meeting" | "document" | "dump";
    id: string;
    title: string;
  }>;
  updatedAt?: string | null;
  pending?: number;
}

export interface RoleProfileBuildStatusApi {
  status: "idle" | "queued" | "running";
  since?: string | null;
}

export interface MyProfileRoleProfileApi {
  id: string;
  status: "forming" | "ready" | "stale" | "error";
  buildVersion: number;
  lastBuildAt: string | null;
  roleMap: RoleMapApi | null;
}

export interface MyProfileApi {
  person: { id: string; name: string; email: string } | null;
  primaryRole: { id: string; name: string } | null;
  primaryDepartment: { id: string; name: string } | null;
  roleProfile: MyProfileRoleProfileApi | null;
}

export const departmentsApi = {
  list: (orgId: string) =>
    apiClient.get<ListDepartmentsResponseApi>("/api/v1/departments", {
      headers: orgHeaders(orgId),
    }),

  create: (orgId: string, body: CreateDepartmentRequest) =>
    apiClient.post<{ department: DepartmentApi }>("/api/v1/departments", body, {
      headers: orgHeaders(orgId),
    }),

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

  setHead: (orgId: string, id: string, body: SetDepartmentHeadRequest) =>
    apiClient.patch<DepartmentApi>(
      `/api/v1/departments/${encodeURIComponent(id)}/head`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  merge: (orgId: string, sourceId: string, intoId: string) =>
    apiClient.post<MergeDepartmentResponse>(
      `/api/v1/departments/${encodeURIComponent(sourceId)}/merge`,
      { intoId },
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
    apiClient.post<{ role: RoleDomainApi }>("/api/v1/roles", body, {
      headers: orgHeaders(orgId),
    }),

  update: (orgId: string, id: string, body: UpdateRoleRequest) =>
    apiClient.patch<{ role: RoleDomainApi }>(
      `/api/v1/roles/${encodeURIComponent(id)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  remove: (orgId: string, id: string) =>
    apiClient.del<{ ok: true }>(`/api/v1/roles/${encodeURIComponent(id)}`, {
      headers: orgHeaders(orgId),
    }),
};

interface PersonListItemApi {
  id: string;
  name: string | null;
  email: string | null;
  userId: string | null;
  primaryDepartmentId: string | null;
  primaryDepartmentName: string | null;
  currentRoleId: string | null;
  currentRoleName: string | null;
  invitationStatus: PersonDomainApi["invitationStatus"];
  createdAt: string;
}

function mapPersonFromApi(
  raw: PersonListItemApi,
  orgId: string,
): PersonDomainApi {
  return {
    id: raw.id,
    orgId,
    fullName: raw.name ?? "",
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
  list: (
    orgId: string,
    query: ListPersonsQuery = {},
  ): Promise<ListPersonsResponseApi> =>
    apiClient
      .get<{
        items: PersonListItemApi[];
        total?: number;
      }>(`/api/v1/persons${buildQuery({ ...query })}`, { headers: orgHeaders(orgId) })
      .then((r) => ({
        items: r.items.map((p) => mapPersonFromApi(p, orgId)),
        total: r.total,
      })),

  byId: (orgId: string, id: string): Promise<{ person: PersonDomainApi }> =>
    apiClient
      .get<{
        person: PersonListItemApi;
      }>(`/api/v1/persons/${encodeURIComponent(id)}`, { headers: orgHeaders(orgId) })
      .then((r) => ({ person: mapPersonFromApi(r.person, orgId) })),

  create: (orgId: string, body: CreatePersonRequest) =>
    apiClient.post<{ person: PersonDomainApi }>(
      "/api/v1/persons",
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
    apiClient.del<{ ok: true }>(`/api/v1/persons/${encodeURIComponent(id)}`, {
      headers: orgHeaders(orgId),
    }),

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
    apiClient.get<StructureSummaryApi>("/api/v1/structure/summary", {
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
    apiClient.get<MyProfileApi>("/api/v1/me/profile", {
      headers: orgHeaders(orgId),
    }),
};
