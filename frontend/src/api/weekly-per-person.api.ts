import { apiClient } from './api-client';

/**
 * ТЗ-D Фаза 5 (2026-06-05) — API-клиент недельного план-факта по людям.
 *
 *   GET /api/v1/dashboard/operations/weekly-per-person
 *         ?weekStart=YYYY-MM-DD&limit=5&offset=0&sort=reliability|risk
 *
 * Зеркалирует `WeeklyPerPersonDto` / `WeeklyPersonRowDto` из
 * `backend/src/modules/operations/dto/weekly-per-person.dto.ts`.
 * Доступ: coo / owner / admin / super_admin
 * (см. `RbacService.canViewOperationsDashboard`). БЕЗ финансовых данных.
 */

/** Строка план-факта по одному человеку за неделю. */
export interface WeeklyPersonRowApi {
  personId: string;
  personName: string;
  departmentName: string | null;
  /** Обещания, ДАННЫЕ человеком (по commitmentAuthorPersonId). */
  promisesGiven: number;
  promisesKept: number;
  promisesBroken: number;
  promisesOverdue: number;
  /** Обещания со статусом «спросили», на которые ещё нет ответа. */
  promisesNoAnswer: number;
  /**
   * kept / (kept+broken+overdue) * 100. null в ДВУХ случаях: знаменатель=0
   * (обещаний нет) ИЛИ знаменатель меньше минимума (по умолчанию 3 — «мало
   * данных»). Чтобы отличить эти случаи, фронт сам считает знаменатель.
   */
  reliabilityPercent: number | null;
  /** Закрытые задачи за неделю. */
  tasksDone: number;
  /** Завершённые чек-ины за неделю. */
  checkInsCompleted: number;
}

export interface WeeklyPerPersonApi {
  weekStart: string;
  weekEnd: string;
  generatedAt: string;
  total: number;
  topReliable: WeeklyPersonRowApi[];
  topRisk: WeeklyPersonRowApi[];
  rows: WeeklyPersonRowApi[];
}

export const weeklyPerPersonApi = {
  get: (
    weekStart: string,
    opts?: { limit?: number; offset?: number; sort?: 'reliability' | 'risk' },
  ) => {
    const p = new URLSearchParams({ weekStart });
    if (opts?.limit != null) p.set('limit', String(opts.limit));
    if (opts?.offset != null) p.set('offset', String(opts.offset));
    if (opts?.sort) p.set('sort', opts.sort);
    return apiClient.get<WeeklyPerPersonApi>(
      `/api/v1/dashboard/operations/weekly-per-person?${p.toString()}`,
    );
  },
};
