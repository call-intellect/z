import type { AccountUserApi, SignupSourceApi } from "@/api/types/accounts";
import type { UserRole } from "./enums";

export type SignupSource = SignupSourceApi;

export type CurrentOrgRole = "owner" | "admin" | "manager" | "coo" | null;

export interface AccountUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  signupSource: SignupSource;
  mustChangePassword: boolean;
  createdAt: Date;
  isSuperAdmin: boolean;
  currentOrgRole: CurrentOrgRole;
  currentOrgId: string | null;
  profileCompletedAt: Date | null;
}

export function mapAccountUserDtoToDomain(dto: AccountUserApi): AccountUser {
  return {
    id: dto.id,
    email: dto.email,
    name: dto.name,
    role: dto.role,
    signupSource: dto.signupSource,
    mustChangePassword: dto.mustChangePassword,
    createdAt: new Date(dto.createdAt),
    isSuperAdmin: dto.isSuperAdmin === true,
    currentOrgRole: dto.currentOrgRole,
    currentOrgId: dto.currentOrgId,
    profileCompletedAt: dto.profileCompletedAt
      ? new Date(dto.profileCompletedAt)
      : null,
  };
}
