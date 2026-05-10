import { apiClient } from './api-client';

/**
 * API DTO для модуля orgs (Org / Membership / Invitation).
 * Источник правды — backend/src/modules/orgs/.
 */

export type OrgApi = {
  id: string;
  name: string;
  slug: string;
  visibilityMode: 'open' | 'strict';
  tier: 'basic' | 'pro' | 'enterprise';
  ownerId: string;
  createdAt: string;
};

export type MembershipApi = {
  userId: string;
  email: string;
  name: string;
  role: 'owner' | 'admin' | 'manager';
  joinedAt: string;
  invitedBy: string | null;
};

export type OrgInvitationApi = {
  id: string;
  orgId: string;
  orgName: string;
  email: string;
  role: 'owner' | 'admin' | 'manager';
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
};

export type CreateOrgRequest = { name: string };
export type UpdateOrgRequest = {
  name?: string;
  visibilityMode?: 'open' | 'strict';
};
export type InviteMemberRequest = {
  email: string;
  role?: 'admin' | 'manager';
};
export type UpdateMemberRequest = {
  role: 'owner' | 'admin' | 'manager';
};

export const orgsApi = {
  create: (body: CreateOrgRequest) =>
    apiClient.post<{ org: { id: string; name: string; slug: string } }>(
      '/api/v1/orgs',
      body,
    ),

  listMine: () => apiClient.get<{ orgs: OrgApi[] }>('/api/v1/orgs/me'),

  byId: (orgId: string) =>
    apiClient.get<{ org: OrgApi }>(`/api/v1/orgs/${encodeURIComponent(orgId)}`),

  update: (orgId: string, body: UpdateOrgRequest) =>
    apiClient.patch<{ org: OrgApi }>(
      `/api/v1/orgs/${encodeURIComponent(orgId)}`,
      body,
    ),

  listMembers: (orgId: string) =>
    apiClient.get<{ members: MembershipApi[] }>(
      `/api/v1/orgs/${encodeURIComponent(orgId)}/members`,
    ),

  updateMember: (orgId: string, userId: string, body: UpdateMemberRequest) =>
    apiClient.patch<{ member: MembershipApi }>(
      `/api/v1/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`,
      body,
    ),

  removeMember: (orgId: string, userId: string) =>
    apiClient.del<{ ok: true }>(
      `/api/v1/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`,
    ),

  invite: (orgId: string, body: InviteMemberRequest) =>
    apiClient.post<{ invitation: OrgInvitationApi }>(
      `/api/v1/orgs/${encodeURIComponent(orgId)}/invitations`,
      body,
    ),

  listInvitations: (orgId: string) =>
    apiClient.get<{ invitations: OrgInvitationApi[] }>(
      `/api/v1/orgs/${encodeURIComponent(orgId)}/invitations`,
    ),

  revokeInvitation: (orgId: string, invitationId: string) =>
    apiClient.del<{ ok: true }>(
      `/api/v1/orgs/${encodeURIComponent(orgId)}/invitations/${encodeURIComponent(invitationId)}`,
    ),

  acceptInvitation: (token: string) =>
    apiClient.post<{
      orgId: string;
      membership: { role: 'owner' | 'admin' | 'manager'; joinedAt: string };
    }>(`/api/v1/orgs/invitations/${encodeURIComponent(token)}/accept`),
};
