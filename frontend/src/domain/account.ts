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

export interface AccountUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  signupSource: SignupSource;
  mustChangePassword: boolean;
  createdAt: Date;
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
  };
}
