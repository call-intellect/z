import type { UserRole } from "@/domain/enums";

export type SignupSourceApi = "crossmark" | "standalone";

export interface AccountUserApi {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  signupSource: SignupSourceApi;
  mustChangePassword: boolean;
  createdAt: string;
  isSuperAdmin: boolean;
  currentOrgRole: "owner" | "admin" | "manager" | "coo" | null;
  currentOrgId: string | null;
  profileCompletedAt: string | null;
}

export interface AccountsRegisterRequest {
  email: string;
  name: string;
  phone?: string;
  companyName?: string;
  honeypot?: string;
  ref?: string;
  consentDataProcessing?: boolean;
  consentMarketing?: boolean;
}

export interface AccountsLoginRequest {
  email: string;
  password: string;
}

export interface AccountsForgotPasswordRequest {
  email: string;
}

export interface AccountsResetPasswordRequest {
  token: string;
  newPassword: string;
}

export interface AccountsChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface AccountsUpdateProfileRequest {
  name: string;
}

export interface AccountsRegisterResponse {
  status: "ok";
  email_sent: boolean;
  email_error?: string;
}

export interface AccountsLoginResponse {
  user: AccountUserApi;
  mustChangePassword: boolean;
}

export interface AccountsMeResponse {
  user: AccountUserApi | null;
}

export interface AccountsUpdateMeResponse {
  user: AccountUserApi;
}

export interface AccountsOkResponse {
  ok: true;
}

export interface AcceptInvitationMagicLinkRequest {
  magicToken: string;
}

export interface AcceptInvitationMagicLinkResponse {
  user: AccountUserApi;
}
