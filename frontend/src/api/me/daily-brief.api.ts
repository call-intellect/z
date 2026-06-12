/**
 * API-клиент персонального брифа «Твой день» (self-scope).
 *
 * ТЗ 2026-06-11 mobile-cora-exec-manager, Ф0. Читает существующий backend
 * `GET /api/v1/me/daily-brief?date=YYYY-MM-DD` (контроллер
 * `backend/src/modules/operations/controllers/my-daily-brief.controller.ts`)
 * и отмечает бриф открытым `POST /me/daily-brief/:id/opened`.
 *
 * Источник правды контракта — `backend/.../dto/personal-daily-brief.dto.ts`
 * (`DailyBriefDto`/`toDailyBriefDto`/`emptyDailyBriefDto`). Здесь — зеркало
 * ApiDto; маппинг в DomainModel — `src/domain/me/daily-brief.ts`.
 *
 * Self-scope: tenant резолвится из дефолтного `X-Org-Id` (apiClient ставит
 * сам), self-person — на бэке из cookie-сессии. Нет Person → пустой бриф 200.
 */

import { apiClient } from '../api-client';

/** Один пункт брифа (задача/обещание/блокер). Зеркало `DailyBriefItemDto`. */
export interface BriefItemApi {
  kind: string;
  title: string;
  dueDateIso: string | null;
  overdue: boolean;
  counterpartyName: string | null;
}

/** «Кто знает X» — носитель знания по блокеру. Зеркало `DailyBriefKnowsWhoDto`. */
export interface BriefKnowsWhoApi {
  blockId: string;
  blockerText: string;
  expertPersonId: string;
  expertName: string;
  confidence: number;
}

/**
 * «Ты не один» — со-встречаемость инсайта у коллег. На бэке в текущем
 * `DailyBriefDto` поля НЕТ (см. dto-источник), поэтому опционально: если
 * backend добавит — фронт подхватит без правок. Сейчас всегда `undefined`.
 */
export interface BriefInsightCoOccurrenceApi {
  statement: string;
  colleaguesCount: number;
  escalated: boolean;
}

/** Ответ `GET /api/v1/me/daily-brief`. Зеркало `DailyBriefDto`. */
export interface DailyBriefApi {
  /** null — брифа за этот день ещё нет (cron не построил / не утро). */
  id: string | null;
  dateLocal: string;
  myTasks: BriefItemApi[];
  myPromises: BriefItemApi[];
  myBlockers: BriefItemApi[];
  promisedToMe: BriefItemApi[];
  hint: string;
  knowsWho: BriefKnowsWhoApi | null;
  /** Опционально — backend пока не отдаёт (см. BriefInsightCoOccurrenceApi). */
  insightCoOccurrence?: BriefInsightCoOccurrenceApi | null;
  counts: {
    tasks: number;
    promises: number;
    blockers: number;
    promisedToMe: number;
  };
  deliveredAt: string | null;
  openedAt: string | null;
}

export const meDailyBriefApi = {
  /**
   * Мой бриф за день (self-scope). `date` опционально (YYYY-MM-DD); без него
   * бэк берёт сегодня в Europe/Moscow.
   */
  get: (date?: string) =>
    apiClient.get<DailyBriefApi>(
      date
        ? `/api/v1/me/daily-brief?date=${encodeURIComponent(date)}`
        : '/api/v1/me/daily-brief',
    ),

  /** Отметить бриф открытым (engagement: openedAt). Только при `id!==null`. */
  markOpened: (id: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/me/daily-brief/${encodeURIComponent(id)}/opened`,
    ),
};
