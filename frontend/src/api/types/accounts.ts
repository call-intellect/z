/**
 * API DTO для модуля accounts (standalone-аккаунты).
 * Источник правды — backend/src/modules/accounts/.
 *
 * Здесь только сырые контракты с бэка. Доменные модели (camelCase, Date) —
 * в `src/domain/account.ts`. Маппер — там же.
 */

import type { UserRole } from '@/domain/enums';

export type SignupSourceApi = 'crossmark' | 'standalone';

export interface AccountUserApi {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  signupSource: SignupSourceApi;
  mustChangePassword: boolean;
  createdAt: string;
  /** Фаза 7: super_admin (Z-Admin). */
  isSuperAdmin: boolean;
  /** Фаза 7: роль в первой Org или null. SBA β-8 добавила 'coo'. */
  currentOrgRole: 'owner' | 'admin' | 'manager' | 'coo' | null;
  /** Фаза 7: id первой Org или null. */
  currentOrgId: string | null;
}

// ─────────────── request payloads ───────────────

export interface AccountsRegisterRequest {
  email: string;
  name: string;
  /** Опциональный номер телефона. */
  phone?: string;
  /** Опциональное название компании. Если пусто — бэк подставит "Компания {name}". */
  companyName?: string;
  /** Honeypot — пустое поле, видимое только ботам. */
  honeypot?: string;
  /** Реферральная ссылка из URL параметра. */
  ref?: string;
  /** Обязательное согласие на обработку персональных данных. */
  consentDataProcessing?: boolean;
  /** Опциональное согласие на маркетинговые рассылки. */
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

// ─────────────── response payloads ───────────────

export interface AccountsRegisterResponse {
  status: 'ok';
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

/**
 * β-9 — приём приглашения по magic-link (публичный, без auth).
 * Бэкенд: `POST /api/v1/accounts/invitations/accept-magic`.
 * После успеха сессия установлена через cookie `z_session` в Set-Cookie.
 */
export interface AcceptInvitationMagicLinkRequest {
  magicToken: string;
}

export interface AcceptInvitationMagicLinkResponse {
  user: AccountUserApi;
}
