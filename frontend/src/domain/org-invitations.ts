import type {
  OrgInvitationApi,
  OrgInvitationCreateResultApi,
} from "@/api/orgs.api";

export type OrgInvitationRole =
  | "owner"
  | "admin"
  | "manager"
  | "coo"
  | "hr_partner";
export type OrgInvitationStatus =
  | "pending"
  | "accepted"
  | "revoked"
  | "expired";

export interface OrgInvitationDomain {
  id: string;
  orgId: string;
  orgName: string;
  email: string | null;
  role: OrgInvitationRole;
  status: OrgInvitationStatus;
  invitedBy: string;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
}

export interface OrgInvitationCreateResultDomain extends OrgInvitationDomain {
  linkCode: string;
  magicLinkUrl: string;
  telegramDeepLink: string;
  manualShareUrl: string;
  qrCodeDataUrl: string | null;
}

export function mapOrgInvitationDtoToDomain(
  dto: OrgInvitationApi,
): OrgInvitationDomain {
  return {
    id: dto.id,
    orgId: dto.orgId,
    orgName: dto.orgName,
    email: dto.email,
    role: dto.role,
    status: dto.status,
    invitedBy: dto.invitedBy,
    createdAt: new Date(dto.createdAt),
    expiresAt: new Date(dto.expiresAt),
    acceptedAt: dto.acceptedAt ? new Date(dto.acceptedAt) : null,
  };
}

export function mapOrgInvitationCreateResultDtoToDomain(
  dto: OrgInvitationCreateResultApi,
): OrgInvitationCreateResultDomain {
  return {
    ...mapOrgInvitationDtoToDomain(dto),
    linkCode: dto.linkCode,
    magicLinkUrl: dto.magicLinkUrl,
    telegramDeepLink: dto.telegramDeepLink,
    manualShareUrl: dto.manualShareUrl,
    qrCodeDataUrl: dto.qrCodeDataUrl,
  };
}

export function describeInvitationStatus(
  status: OrgInvitationStatus,
  expiresAt: Date,
): { label: string; tone: "pending" | "success" | "warning" | "muted" } {
  if (status === "accepted") return { label: "Принято", tone: "success" };
  if (status === "revoked") return { label: "Отозвано", tone: "muted" };
  if (status === "expired") return { label: "Истекло", tone: "warning" };
  const hoursLeft = (expiresAt.getTime() - Date.now()) / 3_600_000;
  if (hoursLeft <= 0) return { label: "Истекло", tone: "warning" };
  return { label: "Ожидает", tone: "pending" };
}
