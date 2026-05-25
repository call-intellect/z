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

/**
 * β-9 (2026-05-25): email стал nullable — линейный персонал (продавцы,
 * повара, мастера) может работать только через Telegram, без e-mail.
 * Подробности — `plans/tz/2026-05-25-telegram-bot-global-and-invites.md` §3
 * принцип 4 и `second-brain/01_projects/conversational-channels.md`
 * §«Продуктовые принципы каналов» принцип 3.
 */
export type OrgInvitationApi = {
  id: string;
  orgId: string;
  orgName: string;
  /** β-9: nullable, см. JSDoc выше. */
  email: string | null;
  role: 'owner' | 'admin' | 'manager';
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
};

/**
 * β-9 — расширенный ответ `createInvitation` / `resendInvitation` с
 * «горячими» полями для UI директора: deep-link бота, magic-link URL
 * для копирования вручную и QR (опц., с backend-стороны может быть null).
 */
export type OrgInvitationCreateResultApi = OrgInvitationApi & {
  /** Короткий код для Telegram-бота (на случай ручного ввода `/start <code>`). */
  linkCode: string;
  /** Magic-link для одноразового входа в кабинет без пароля. */
  magicLinkUrl: string;
  /** Telegram deep-link: `https://t.me/<bot>?start=<linkCode>`. */
  telegramDeepLink: string;
  /** То же что magicLinkUrl — главная ссылка для копирования директором. */
  manualShareUrl: string;
  /** data-URL PNG QR-кода или null (frontend может догенерить через CDN). */
  qrCodeDataUrl: string | null;
};

export type CreateOrgRequest = { name: string };
export type UpdateOrgRequest = {
  name?: string;
  visibilityMode?: 'open' | 'strict';
};
/**
 * β-9 — email опционален; name обязателен (показывается в карточке pending);
 * role расширена дефолтом 'manager'.
 */
export type InviteMemberRequest = {
  email?: string;
  name: string;
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

  /**
   * β-9 — возвращает расширенный объект `OrgInvitationCreateResultApi`
   * с manualShareUrl / telegramDeepLink / linkCode / qrCodeDataUrl,
   * чтобы UI мог сразу показать модал «Скопировать ссылку».
   */
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

  /**
   * β-9 — перевыпуск приглашения: новый linkCode + magic-token,
   * повторная отправка письма (если email указан). Возвращает
   * обновлённое приглашение с новой парой URL'ов.
   */
  resendInvitation: (orgId: string, invitationId: string) =>
    apiClient.post<{ invitation: OrgInvitationCreateResultApi }>(
      `/api/v1/orgs/${encodeURIComponent(orgId)}/invitations/${encodeURIComponent(invitationId)}/resend`,
    ),

  /**
   * β-9 — сброс привязки Telegram-бота сотрудника директором.
   * Удаляет все ChannelBinding пользователя для kind='telegram_bot'.
   */
  resetMemberTelegramBinding: (orgId: string, userId: string) =>
    apiClient.del<{ ok: true; removed: number }>(
      `/api/v1/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}/telegram-binding`,
    ),

  acceptInvitation: (token: string) =>
    apiClient.post<{
      orgId: string;
      membership: { role: 'owner' | 'admin' | 'manager'; joinedAt: string };
    }>(`/api/v1/orgs/invitations/${encodeURIComponent(token)}/accept`),
};
