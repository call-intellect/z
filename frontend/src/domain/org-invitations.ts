/**
 * Domain-модель приглашения сотрудника в Org и связанные мапперы.
 *
 * β-9 (2026-05-25) — поддержка GitHub-style flow:
 *   - email может отсутствовать (линейный персонал без e-mail);
 *   - после `createInvitation`/`resendInvitation` бэк отдаёт
 *     «горячие» поля для модального окна директора:
 *     `manualShareUrl`, `telegramDeepLink`, `linkCode`, `qrCodeDataUrl`.
 *
 * Источник правды — `backend/src/modules/orgs/org-invitations.service.ts`
 * (типы `OrgInvitationDomain`/`OrgInvitationCreateResult`).
 *
 * Слои: ApiDto (`OrgInvitationApi`) → DomainModel (этот файл) → UiModel
 * (формирует страница `settings/organization`).
 */

import type {
  OrgInvitationApi,
  OrgInvitationCreateResultApi,
} from '@/api/orgs.api';

export type OrgInvitationRole = 'owner' | 'admin' | 'manager';
export type OrgInvitationStatus =
  | 'pending'
  | 'accepted'
  | 'revoked'
  | 'expired';

export interface OrgInvitationDomain {
  id: string;
  orgId: string;
  orgName: string;
  /** β-9: nullable — отсутствует у линейного персонала. */
  email: string | null;
  role: OrgInvitationRole;
  status: OrgInvitationStatus;
  invitedBy: string;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
}

export interface OrgInvitationCreateResultDomain extends OrgInvitationDomain {
  /** Короткий код для прямого ввода в Telegram-бота `/start <linkCode>`. */
  linkCode: string;
  /** Полный magic-link для входа в кабинет без пароля. */
  magicLinkUrl: string;
  /** Telegram deep-link: `https://t.me/<bot>?start=<linkCode>`. */
  telegramDeepLink: string;
  /** Главная ссылка для копирования директором (равна magicLinkUrl). */
  manualShareUrl: string;
  /** data-URL PNG QR-кода либо null (фронт может догенерить через CDN). */
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

/** Текстовый статус для UI с цветовой подсказкой. */
export function describeInvitationStatus(
  status: OrgInvitationStatus,
  expiresAt: Date,
): { label: string; tone: 'pending' | 'success' | 'warning' | 'muted' } {
  if (status === 'accepted') return { label: 'Принято', tone: 'success' };
  if (status === 'revoked') return { label: 'Отозвано', tone: 'muted' };
  if (status === 'expired') return { label: 'Истекло', tone: 'warning' };
  // pending: подсветим «истечёт скоро» если до экспирации < 24ч.
  const hoursLeft = (expiresAt.getTime() - Date.now()) / 3_600_000;
  if (hoursLeft <= 0) return { label: 'Истекло', tone: 'warning' };
  return { label: 'Ожидает', tone: 'pending' };
}
