/**
 * API-слой модуля accounts (standalone-аккаунты).
 *
 * Все вызовы идут через единый `apiClient`. Контракты — в
 * `./types/accounts.ts`. Мапперы в DomainModel — в `@/domain/account.ts`.
 *
 * Эндпоинты — backend `AccountsController` (`/api/v1/accounts/*`).
 */

import { apiClient } from './api-client';
import type {
  AccountsChangePasswordRequest,
  AccountsForgotPasswordRequest,
  AccountsLoginRequest,
  AccountsLoginResponse,
  AccountsMeResponse,
  AccountsOkResponse,
  AccountsRegisterRequest,
  AccountsRegisterResponse,
  AccountsResetPasswordRequest,
  AccountsUpdateMeResponse,
  AccountsUpdateProfileRequest,
} from './types/accounts';

export const accountsApi = {
  register: (body: AccountsRegisterRequest) =>
    apiClient.post<AccountsRegisterResponse>('/api/v1/accounts/register', body),

  login: (body: AccountsLoginRequest) =>
    apiClient.post<AccountsLoginResponse>('/api/v1/accounts/login', body),

  logout: () =>
    apiClient.post<AccountsOkResponse>('/api/v1/accounts/logout'),

  forgotPassword: (body: AccountsForgotPasswordRequest) =>
    apiClient.post<AccountsOkResponse>('/api/v1/accounts/password/forgot', body),

  resetPassword: (body: AccountsResetPasswordRequest) =>
    apiClient.post<AccountsOkResponse>('/api/v1/accounts/password/reset', body),

  me: () => apiClient.get<AccountsMeResponse>('/api/v1/accounts/me'),

  updateMe: (body: AccountsUpdateProfileRequest) =>
    apiClient.patch<AccountsUpdateMeResponse>('/api/v1/accounts/me', body),

  changePassword: (body: AccountsChangePasswordRequest) =>
    apiClient.post<AccountsOkResponse>('/api/v1/accounts/me/change-password', body),
};
