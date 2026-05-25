/**
 * Доменная модель журнала super_admin (admin-redesign Фаза 1).
 *
 * Контракт: backend `AdminAuditController` (планируется как часть Фазы 1).
 * Источник записей — модель `SuperAdminAccessLog`. Cursor-based pagination
 * через opaque base64-cursor `{ createdAt, id }`.
 */

// ─── API DTO ────────────────────────────────────────────────────────────────

export type AdminAuditEntryApi = {
  id: string;
  createdAt: string;
  superAdminUserId: string;
  superAdminEmail: string | null;
  accessedTenantId: string | null;
  accessedTenantName: string | null;
  route: string;
  method: string;
  reason: string | null;
  params: unknown;
};

export type AdminAuditListApi = {
  items: AdminAuditEntryApi[];
  nextCursor: string | null;
};

export type AdminAuditAdminApi = {
  userId: string;
  email: string;
  totalActions: number;
  lastActionAt: string | null;
};

export type AdminAuditAdminsListApi = {
  items: AdminAuditAdminApi[];
};

// ─── Domain model ───────────────────────────────────────────────────────────

export type AdminAuditEntryDomain = Omit<AdminAuditEntryApi, 'createdAt'> & {
  createdAt: Date;
};

export type AdminAuditListDomain = {
  items: AdminAuditEntryDomain[];
  nextCursor: string | null;
};

export type AdminAuditAdminDomain = Omit<
  AdminAuditAdminApi,
  'lastActionAt'
> & {
  lastActionAt: Date | null;
};

export type AdminAuditAdminsListDomain = {
  items: AdminAuditAdminDomain[];
};

// ─── Mappers ────────────────────────────────────────────────────────────────

export function adminAuditEntryFromApi(
  api: AdminAuditEntryApi,
): AdminAuditEntryDomain {
  return { ...api, createdAt: new Date(api.createdAt) };
}

export function adminAuditListFromApi(
  api: AdminAuditListApi,
): AdminAuditListDomain {
  return {
    items: api.items.map(adminAuditEntryFromApi),
    nextCursor: api.nextCursor,
  };
}

export function adminAuditAdminFromApi(
  api: AdminAuditAdminApi,
): AdminAuditAdminDomain {
  return {
    ...api,
    lastActionAt: api.lastActionAt ? new Date(api.lastActionAt) : null,
  };
}

export function adminAuditAdminsListFromApi(
  api: AdminAuditAdminsListApi,
): AdminAuditAdminsListDomain {
  return { items: api.items.map(adminAuditAdminFromApi) };
}
