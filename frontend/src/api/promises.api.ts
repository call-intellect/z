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
  sourceMeetingId: string | null;
  sourceMeetingTitle: string | null;
  askedAt: string | null;
  escalatedAt: string | null;
  createdAt: string;
}

/**
 * Редизайн Ф7б — открытый вопрос. Это НЕ обещание: блок-обещание, у которого
 * не хватает данных до полноценного обещания (нет автора / нет ответственного
 * и срока). Бэк отдаёт их отдельным массивом, чтобы они не считались
 * «обещаниями этого человека».
 */
export interface OpenQuestionApi {
  id: string;
  text: string;
  sourceMeetingId: string | null;
  sourceMeetingTitle: string | null;
  /** Чего не хватает до полного обещания (человекочитаемо, RU). */
  reason: string;
  createdAt: string;
}

export interface MarkPromiseBody {
  status: 'fulfilled' | 'missed' | 'cancelled' | 'superseded';
  note?: string;
}

/**
 * Редизайн Ф7б — ответ `GET /me/promises`: полные обещания (`items`) +
 * открытые вопросы (`openQuestions`). `items` совместим с прежним контрактом.
 */
export interface MyPromisesListApi {
  items: CommitmentApi[];
  openQuestions: OpenQuestionApi[];
}

export const promisesApi = {
  list: (params?: { status?: 'open' | 'asked' | 'all'; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.limit) q.set('limit', String(params.limit));
    const suffix = q.toString();
    return apiClient.get<MyPromisesListApi>(
      `/api/v1/me/promises${suffix ? `?${suffix}` : ''}`,
    );
  },
  mark: (blockId: string, body: MarkPromiseBody) =>
    apiClient.post<CommitmentApi>(`/api/v1/me/promises/${blockId}/mark`, body),
  reschedule: (blockId: string, body: { dueDate: string; note?: string }) =>
    apiClient.patch<CommitmentApi>(
      `/api/v1/me/promises/${encodeURIComponent(blockId)}/reschedule`,
      body,
    ),
};
