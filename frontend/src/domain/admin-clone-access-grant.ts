/**
 * Domain-слой для admin-страницы «Управление доступом к клонам».
 *
 * ApiDto → DomainModel:
 *   - ISO-строки → Date;
 *   - вычисляемый `status: 'active' | 'revoked' | 'expired'` для удобства UI
 *     (бэк уже возвращает `isActive + inactiveReason`, но в одном поле UI
 *     проще ветвить).
 *
 * Контракт API: `frontend/src/api/admin-clones.api.ts`.
 */

import type {
  AccessGrantApi,
  AccessGrantListResponseApi,
  AccessGrantUserSummaryApi,
  CloneTypeApi,
} from '@/api/admin-clones.api';

// ─────────────── domain-типы ───────────────

export type AccessGrantStatus = 'active' | 'revoked' | 'expired';

export const ACCESS_GRANT_STATUS_LABELS: Record<AccessGrantStatus, string> = {
  active: 'Активен',
  revoked: 'Отозван',
  expired: 'Истёк',
};

export const CLONE_TYPE_LABELS: Record<CloneTypeApi, string> = {
  role: 'Должность',
  person: 'Сотрудник',
};

export interface AccessGrantUserSummary {
  userId: string;
  userName: string;
  userEmail: string | null;
}

export interface AccessGrant {
  id: string;
  cloneType: CloneTypeApi;
  cloneRefId: string;
  cloneLabel: string;
  grantedTo: AccessGrantUserSummary;
  grantedBy: AccessGrantUserSummary;
  grantedAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  revokedBy: AccessGrantUserSummary | null;
  isActive: boolean;
  inactiveReason: 'revoked' | 'expired' | null;
  /** Производное от `isActive` + `inactiveReason` для прямой ветви UI. */
  status: AccessGrantStatus;
}

export interface AccessGrantListDomain {
  items: AccessGrant[];
  total: number;
  page: number;
  pageSize: number;
}

// ─────────────── мапперы ───────────────

export function accessGrantUserFromApi(
  api: AccessGrantUserSummaryApi,
): AccessGrantUserSummary {
  return {
    userId: api.userId,
    userName: api.userName,
    userEmail: api.userEmail ?? null,
  };
}

export function accessGrantFromApi(api: AccessGrantApi): AccessGrant {
  const status: AccessGrantStatus = api.isActive
    ? 'active'
    : api.inactiveReason === 'revoked'
      ? 'revoked'
      : 'expired';

  return {
    id: api.id,
    cloneType: api.cloneType,
    cloneRefId: api.cloneRefId,
    cloneLabel: api.cloneLabel,
    grantedTo: accessGrantUserFromApi(api.grantedTo),
    grantedBy: accessGrantUserFromApi(api.grantedBy),
    grantedAt: new Date(api.grantedAt),
    expiresAt: api.expiresAt ? new Date(api.expiresAt) : null,
    revokedAt: api.revokedAt ? new Date(api.revokedAt) : null,
    revokedBy: api.revokedBy ? accessGrantUserFromApi(api.revokedBy) : null,
    isActive: api.isActive,
    inactiveReason: api.inactiveReason,
    status,
  };
}

export function accessGrantListFromApi(
  api: AccessGrantListResponseApi,
): AccessGrantListDomain {
  return {
    items: api.items.map(accessGrantFromApi),
    total: api.total,
    page: api.page,
    pageSize: api.pageSize,
  };
}
