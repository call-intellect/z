/**
 * UI-доменная модель аккаунта (`AccountUser`) и маппер из ApiDto.
 *
 * Расширяет `UserDomain` (см. `./user.ts`) тремя полями:
 *   - `signupSource` — `'crossmark' | 'standalone'`
 *   - `mustChangePassword` — флаг forced onboarding
 *   - `createdAt: Date` — дата регистрации
 *
 * Для совместимости с существующим `auth-context` (Crossmark deep-link и
 * админ-фло) `AccountUser` остаётся структурно совместимым с `UserDomain`
 * (одинаковые `id/email/name/role`).
 */

import type { AccountUserApi, SignupSourceApi } from '@/api/types/accounts';
import type { UserRole } from './enums';

export type SignupSource = SignupSourceApi;

export type CurrentOrgRole = 'owner' | 'admin' | 'manager' | 'coo' | null;

export interface AccountUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  signupSource: SignupSource;
  mustChangePassword: boolean;
  createdAt: Date;
  /** Z-Admin (Фаза 7) — true только у владельца продукта. */
  isSuperAdmin: boolean;
  /** Роль в первой Org (Фаза 7). null если не в Org. */
  currentOrgRole: CurrentOrgRole;
  /** ID первой Org (Фаза 7). null если не в Org. */
  currentOrgId: string | null;
  /** Когда user завершил Блок A онбординга. null = не прошёл. */
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
    profileCompletedAt: dto.profileCompletedAt ? new Date(dto.profileCompletedAt) : null,
  };
}
