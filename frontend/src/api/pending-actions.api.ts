/**
 * API-клиент Action Center — pending-подтверждения пользователя.
 *
 * Контракт (Фаза B0, backend): `backend/src/modules/pending-actions/*`.
 *   - GET  /api/v1/pending-actions/count
 *   - GET  /api/v1/pending-actions?limit=50
 *   - POST /api/v1/pending-actions/snooze
 *   - POST /api/v1/pending-actions/confirm  (B4 — быстрый путь подтверждения)
 *
 * Все запросы org-scoped — заголовок `X-Org-Id` через `orgHeaders(orgId)`.
 */

import { apiClient } from './api-client';
import { buildQuery, orgHeaders } from './admin-helpers';

export type PendingActionSourceApi =
  | 'curation'
  | 'conflict'
  | 'intake'
  | 'probe';

export type PendingActionSeverityApi = 'normal' | 'urgent';

export interface PendingActionsCountApi {
  total: number;
  bySource: {
    curation: number;
    conflict: number;
    intake: number;
    probe: number;
  };
}

/** Ссылка на момент во встрече (для «открыть на таймкоде»). */
export interface PendingActionCiteApi {
  /** Название встречи (если есть). */
  meetingTitle?: string;
  /** Таймкод вида «34:10». */
  timecode?: string;
  /** Прямая ссылка на встречу/таймкод (если есть). */
  url?: string;
}

/**
 * `detail` — дискриминированный union по `kind` (= source). Несёт реальную
 * суть item'а для inline-резолва из списка. Может отсутствовать (старый бэк
 * / неполные данные) — UI деградирует на `title`.
 */
export interface ProbeDetailApi {
  kind: 'probe';
  question: string;
  context?: string;
  meetingTitle?: string;
  cite?: PendingActionCiteApi;
  notificationId: string;
}

export interface ConflictVersionApi {
  text: string;
  date?: string;
  cite?: PendingActionCiteApi;
}

export interface ConflictDetailApi {
  kind: 'conflict';
  summary: string;
  oldVersion: ConflictVersionApi;
  newVersion: ConflictVersionApi;
}

export interface IntakeDetailApi {
  kind: 'intake';
  title: string;
  description?: string;
  assigneeName?: string;
  dueLabel?: string;
  /** Уверенность Коры, 0..1 либо 0..100 (нормализуем в домене). */
  confidence?: number;
  cite?: PendingActionCiteApi;
}

export interface CurationDetailApi {
  kind: 'curation';
  cardTitle: string;
  preview?: string;
  cite?: PendingActionCiteApi;
}

export type PendingActionDetailApi =
  | ProbeDetailApi
  | ConflictDetailApi
  | IntakeDetailApi
  | CurationDetailApi;

export interface PendingActionItemApi {
  source: PendingActionSourceApi;
  resourceType: string;
  resourceId: string;
  title: string;
  severity: PendingActionSeverityApi;
  ageDays: number;
  actionUrl: string;
  canQuickConfirm: boolean;
  detail?: PendingActionDetailApi;
}

export interface PendingActionsListApi {
  items: PendingActionItemApi[];
}

export interface SnoozePendingActionRequest {
  source: PendingActionSourceApi;
  resourceType: string;
  resourceId: string;
  /** Через сколько часов снова показать (1..720). */
  hours: number;
}

/**
 * Сквозной inline-резолв item'а (Фаза редизайна Ф4). Тело варьируется по
 * источнику:
 *   - probe:    `{ source:'probe', resourceId, answerText }`
 *   - conflict: `{ source:'conflict', resourceId, resolution:'keep_old'|'accept_new'|'merge' }`
 *   - intake:   `{ source:'intake', resourceId, resolution:'accept'|'reject', targetProjectId? }`
 *   - curation: `{ source:'curation', resourceId, resolution:'approve'|'reject' }`
 *
 * Без `resolution`/`answerText` — старый light-путь approve (`canQuickConfirm`).
 * На повторный/невалидный резолв бэк отвечает 400 (BadRequest) — caller
 * показывает toast и откатывает оптимистичную мутацию.
 */
export type PendingActionResolution =
  | 'keep_old'
  | 'accept_new'
  | 'merge'
  | 'accept'
  | 'reject'
  | 'approve';

export interface ConfirmPendingActionRequest {
  source: PendingActionSourceApi;
  resourceId: string;
  /** conflict / intake / curation. */
  resolution?: PendingActionResolution;
  /** probe — свободный ответ пользователя. */
  answerText?: string;
  /** intake accept — опц. целевой проект (иначе берётся suggestedProjectId). */
  targetProjectId?: string;
}

export const pendingActionsApi = {
  count: (orgId: string) =>
    apiClient.get<PendingActionsCountApi>('/api/v1/pending-actions/count', {
      headers: orgHeaders(orgId),
    }),

  list: (orgId: string, limit = 50) =>
    apiClient.get<PendingActionsListApi>(
      `/api/v1/pending-actions${buildQuery({ limit })}`,
      { headers: orgHeaders(orgId) },
    ),

  snooze: (orgId: string, body: SnoozePendingActionRequest) =>
    apiClient.post<void>('/api/v1/pending-actions/snooze', body, {
      headers: orgHeaders(orgId),
    }),

  confirm: (orgId: string, body: ConfirmPendingActionRequest) =>
    apiClient.post<{ ok: true }>('/api/v1/pending-actions/confirm', body, {
      headers: orgHeaders(orgId),
    }),
};
