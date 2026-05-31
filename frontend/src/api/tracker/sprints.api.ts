/**
 * API-клиент модуля tracker.sprints.
 *
 * Контракты:
 *   - `backend/src/modules/tracker/controllers/cycles.controller.ts`
 *     (dashboard / start-meeting / hints на уровне cycles).
 *   - `backend/src/modules/knowledge-core/api/sprint-review.controller.ts`
 *     (review / regenerate).
 *
 * Auth: `CookieAuthGuard + TenantGuard` (cookie + `X-Org-Id` header).
 */

import { apiClient } from '../api-client';
import { orgHeaders } from '../admin-helpers';
import type {
  SprintArchiveListApi,
  SprintArchivePeriodApi,
  SprintArchiveStatusApi,
  SprintDailyDigestApi,
  SprintDashboardApi,
  SprintReviewStateApi,
  SprintWeeklyDigestApi,
} from '@/domain/sprint';

export interface StartSprintMeetingRequest {
  /** По умолчанию backend ставит 'sprint_review'. */
  type?: string;
  title?: string;
  inviteUserIds?: string[];
}

export interface StartSprintMeetingResponse {
  meetingId: string;
  meetingUrl: string;
  token: string;
}

export const sprintsApi = {
  /**
   * Дашборд спринта (агрегированные данные, кэш 5 мин).
   */
  dashboard: (orgId: string, cycleId: string) =>
    apiClient.get<SprintDashboardApi>(
      `/api/v1/cycles/${encodeURIComponent(cycleId)}/dashboard`,
      { headers: orgHeaders(orgId) },
    ),

  /**
   * Запустить встречу-итоги спринта (тип `sprint_review` по умолчанию).
   * Возвращает meetingUrl, на который надо редиректить.
   */
  startMeeting: (
    orgId: string,
    cycleId: string,
    body: StartSprintMeetingRequest,
  ) =>
    apiClient.post<StartSprintMeetingResponse>(
      `/api/v1/cycles/${encodeURIComponent(cycleId)}/start-meeting`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  /**
   * Финальный отчёт спринта. Возвращает discriminated union:
   *   - `ready` — отчёт сгенерирован, рисуем нарратив;
   *   - `pending` — генерация ещё идёт (poll каждые 10с);
   *   - `failed` — AI недоступен, показываем ошибку + кнопку regenerate.
   */
  getReview: (orgId: string, cycleId: string) =>
    apiClient.get<SprintReviewStateApi>(
      `/api/v1/cycles/${encodeURIComponent(cycleId)}/review`,
      { headers: orgHeaders(orgId) },
    ),

  /**
   * Перегенерировать финальный отчёт (например, после failed).
   * Возвращает либо ready, либо failed; pending здесь невозможен — backend
   * запускает синхронно до результата.
   */
  regenerateReview: (orgId: string, cycleId: string) =>
    apiClient.post<SprintReviewStateApi>(
      `/api/v1/cycles/${encodeURIComponent(cycleId)}/review/regenerate`,
      undefined,
      { headers: orgHeaders(orgId) },
    ),

  /**
   * Pulse §5.1 — Daily digest спринта (AI Daily Standup + светофор задач).
   */
  daily: (orgId: string, cycleId: string) =>
    apiClient.get<SprintDailyDigestApi>(
      `/api/v1/cycles/${encodeURIComponent(cycleId)}/dashboard/daily`,
      { headers: orgHeaders(orgId) },
    ),

  /**
   * Pulse §5.2 — Weekly digest спринта (recap + velocity + learnings + forecast).
   */
  weekly: (orgId: string, cycleId: string) =>
    apiClient.get<SprintWeeklyDigestApi>(
      `/api/v1/cycles/${encodeURIComponent(cycleId)}/dashboard/weekly`,
      { headers: orgHeaders(orgId) },
    ),

  /**
   * Pulse §5.3 — Архив гипотез: список всех Cycle tenant'а за период.
   */
  archive: (
    orgId: string,
    args: {
      period?: SprintArchivePeriodApi;
      status?: SprintArchiveStatusApi | 'all';
      q?: string;
    },
  ) => {
    const params = new URLSearchParams();
    if (args.period) params.set('period', args.period);
    if (args.status) params.set('status', args.status);
    if (args.q && args.q.trim()) params.set('q', args.q.trim());
    const qs = params.toString();
    return apiClient.get<SprintArchiveListApi>(
      `/api/v1/sprints/archive${qs ? `?${qs}` : ''}`,
      { headers: orgHeaders(orgId) },
    );
  },
};
