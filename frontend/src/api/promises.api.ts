import { apiClient } from './api-client';

/**
 * SBA β-8.2 — API-клиент `/api/v1/me/promises`.
 *
 *   GET  /?status=open|asked|all&limit=50 — список моих обещаний.
 *   POST /:blockId/mark body={status, note?} — ручное закрытие.
 *
 * Доступ: self-only через CookieAuthGuard + TenantGuard. Сотрудник НЕ видит
 * обещания других сотрудников (фильтр идёт по `Person.userId` на бэке).
 */

export type CommitmentStatusApi =
  | 'open'
  | 'asked'
  | 'fulfilled'
  | 'missed'
  | 'cancelled'
  | 'superseded';

export interface CommitmentApi {
  id: string;
  tenantId: string;
  text: string;
  status: CommitmentStatusApi | null;
  dueDate: string | null;
  recipientPersonId: string | null;
  recipientPersonName: string | null;
  authorPersonId: string | null;
  authorPersonName: string | null;
  askedAt: string | null;
  escalatedAt: string | null;
  createdAt: string;
}

export interface MarkPromiseBody {
  status: 'fulfilled' | 'missed' | 'cancelled' | 'superseded';
  note?: string;
}

export const promisesApi = {
  list: (params?: { status?: 'open' | 'asked' | 'all'; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.limit) q.set('limit', String(params.limit));
    const suffix = q.toString();
    return apiClient.get<{ items: CommitmentApi[] }>(
      `/api/v1/me/promises${suffix ? `?${suffix}` : ''}`,
    );
  },
  mark: (blockId: string, body: MarkPromiseBody) =>
    apiClient.post<CommitmentApi>(`/api/v1/me/promises/${blockId}/mark`, body),
};
