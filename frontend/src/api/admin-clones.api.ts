import { apiClient } from "./api-client";
import { buildQuery, orgHeaders } from "./admin-helpers";

export type CloneTypeApi = "person" | "role";

export interface AccessGrantUserSummaryApi {
  userId: string;
  userName: string;
  userEmail?: string;
}

export interface AccessGrantApi {
  id: string;
  cloneType: CloneTypeApi;
  cloneRefId: string;
  cloneLabel: string;
  grantedTo: AccessGrantUserSummaryApi;
  grantedBy: AccessGrantUserSummaryApi;
  grantedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedBy: AccessGrantUserSummaryApi | null;
  isActive: boolean;
  inactiveReason: "revoked" | "expired" | null;
}

export interface AccessGrantListResponseApi {
  items: AccessGrantApi[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ListAccessGrantsRequest {
  grantedToUserId?: string;
  grantedById?: string;
  cloneType?: CloneTypeApi;
  cloneRefId?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}

export interface CreateAccessGrantBody {
  grantedToUserId: string;
  cloneType: CloneTypeApi;
  cloneRefId: string;
  expiresAt?: string | null;
}

export interface UpdateAccessGrantBody {
  expiresAt: string | null;
}

export interface ListAccessGrantsByCloneRequest {
  includeInactive?: boolean;
}

export const adminClonesApi = {
  listAccessGrants: (orgId: string, req: ListAccessGrantsRequest = {}) =>
    apiClient.get<AccessGrantListResponseApi>(
      `/api/v1/admin/clones/access-grants${buildQuery({ ...req })}`,
      { headers: orgHeaders(orgId) },
    ),

  createAccessGrant: (orgId: string, body: CreateAccessGrantBody) =>
    apiClient.post<AccessGrantApi>(`/api/v1/admin/clones/access-grants`, body, {
      headers: orgHeaders(orgId),
    }),

  revokeAccessGrant: (orgId: string, id: string) =>
    apiClient.del<AccessGrantApi>(
      `/api/v1/admin/clones/access-grants/${encodeURIComponent(id)}`,
      { headers: orgHeaders(orgId) },
    ),

  extendAccessGrant: (orgId: string, id: string, body: UpdateAccessGrantBody) =>
    apiClient.patch<AccessGrantApi>(
      `/api/v1/admin/clones/access-grants/${encodeURIComponent(id)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  listAccessGrantsByClone: (
    orgId: string,
    cloneType: CloneTypeApi,
    cloneRefId: string,
    req: ListAccessGrantsByCloneRequest = {},
  ) =>
    apiClient.get<AccessGrantListResponseApi>(
      `/api/v1/admin/clones/${encodeURIComponent(cloneType)}/${encodeURIComponent(cloneRefId)}/access-grants${buildQuery({ ...req })}`,
      { headers: orgHeaders(orgId) },
    ),
};
