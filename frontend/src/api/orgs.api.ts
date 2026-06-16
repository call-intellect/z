import { apiClient } from "./api-client";

export type OrgApi = {
  id: string;
  name: string;
  slug: string;
  visibilityMode: "open" | "strict";
  tier: "basic" | "pro" | "enterprise";
  isReferenceDemo: boolean;
  ownerId: string;
  createdAt: string;
  industry?: string | null;
  teamSize?: string | null;
  painPoints?: string[];
  currentStack?: string[];
  plannedFeatures?: string[];
  welcomeCompletedAt?: string | null;
  companyInfoCompletedAt?: string | null;
  departmentsCompletedAt?: string | null;
  rolesCompletedAt?: string | null;
  teamInvitedAt?: string | null;
  firstSprintCreatedAt?: string | null;
  firstMeetingCreatedAt?: string | null;
  setupCompletedAt?: string | null;
};

export type OrgMemberRole =
  | "owner"
  | "admin"
  | "manager"
  | "coo"
  | "hr_partner";

export type MembershipApi = {
  userId: string;
  email: string;
  name: string;
  role: OrgMemberRole;
  joinedAt: string;
  invitedBy: string | null;
};

export type OrgInvitationApi = {
  id: string;
  orgId: string;
  orgName: string;
  email: string | null;
  role: OrgMemberRole;
  status: "pending" | "accepted" | "revoked" | "expired";
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
};

export type OrgInvitationCreateResultApi = OrgInvitationApi & {
  linkCode: string;
  magicLinkUrl: string;
  telegramDeepLink: string;
  manualShareUrl: string;
  qrCodeDataUrl: string | null;
};

export type CreateOrgRequest = { name: string };
export type UpdateOrgRequest = {
  name?: string;
  visibilityMode?: "open" | "strict";
};
export type InviteMemberRequest = {
  email?: string;
  name: string;
  role?: "admin" | "manager" | "coo" | "hr_partner";
};
export type UpdateMemberRequest = {
  role: "owner" | "admin" | "manager" | "coo" | "hr_partner";
};

export interface CapabilityItemApi {
  capability: string;
  effect: "allow" | "deny" | null;
  expiresAt: string | null;
}

export const orgsApi = {
  create: (body: CreateOrgRequest) =>
    apiClient.post<{ org: { id: string; name: string; slug: string } }>(
      "/api/v1/orgs",
      body,
    ),

  listMine: () => apiClient.get<{ orgs: OrgApi[] }>("/api/v1/orgs/me"),

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
    apiClient.post<{ invitation: OrgInvitationCreateResultApi }>(
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

  resendInvitation: (orgId: string, invitationId: string) =>
    apiClient.post<{ invitation: OrgInvitationCreateResultApi }>(
      `/api/v1/orgs/${encodeURIComponent(orgId)}/invitations/${encodeURIComponent(invitationId)}/resend`,
    ),

  resetMemberTelegramBinding: (orgId: string, userId: string) =>
    apiClient.del<{ ok: true; removed: number }>(
      `/api/v1/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}/telegram-binding`,
    ),

  acceptInvitation: (token: string) =>
    apiClient.post<{
      orgId: string;
      membership: { role: OrgMemberRole; joinedAt: string };
    }>(`/api/v1/orgs/invitations/${encodeURIComponent(token)}/accept`),

  listMemberCapabilities: (orgId: string, userId: string) =>
    apiClient.get<{ capabilities: CapabilityItemApi[] }>(
      `/api/v1/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}/capabilities`,
    ),

  upsertMemberCapability: (
    orgId: string,
    userId: string,
    capability: string,
    body: { effect: "allow" | "deny"; expiresAt?: string | null },
  ) =>
    apiClient.put<{ item: CapabilityItemApi }>(
      `/api/v1/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}/capabilities/${encodeURIComponent(capability)}`,
      body,
    ),

  removeMemberCapability: (orgId: string, userId: string, capability: string) =>
    apiClient.del<{ ok: true }>(
      `/api/v1/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}/capabilities/${encodeURIComponent(capability)}`,
    ),

  effectiveAccess: (orgId: string) =>
    apiClient.get<{ overrides: Record<string, "allow" | "deny"> }>(
      `/api/v1/orgs/${encodeURIComponent(orgId)}/effective-access`,
    ),
};
