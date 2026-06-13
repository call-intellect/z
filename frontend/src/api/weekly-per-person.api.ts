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
  /** Закрытые задачи за неделю (по моменту закрытия). */
  tasksDone: number;
  /**
   * ТЗ редизайн Ф8.5 — задачи, ЗАПЛАНИРОВАННЫЕ на неделю (по сроку `dueDate`).
   */
  tasksPlanned: number;
  /**
   * ТЗ редизайн Ф8.5 — задачи недели, ещё НЕ сделанные (из запланированных).
   */
  tasksNotDone: number;
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

/* ──────────────────────────────────────────────────────────────────────────
 * ТЗ редизайн Ф8.5 — drill-down «план-факт по людям» (раскрытие строки).
 *   GET /api/v1/dashboard/operations/weekly-per-person/:personId/items?weekStart=
 * Зеркалирует `WeeklyPersonItemDto` / `WeeklyPersonItemsDto` из
 * `backend/src/modules/operations/dto/weekly-per-person.dto.ts`.
 * ────────────────────────────────────────────────────────────────────────── */

/** Источник пункта построчного план-факта. */
export type WeeklyPersonItemKindApi = 'task' | 'commitment' | 'checkin';

/** Статус факта по пункту (объединение трёх источников). */
export type WeeklyPersonItemFactStatusApi =
  | 'done'
  | 'open'
  | 'overdue'
  | 'fulfilled'
  | 'missed'
  | 'asked'
  | 'planned';

/** Один пункт построчного план-факта по человеку за неделю. */
export interface WeeklyPersonItemApi {
  kind: WeeklyPersonItemKindApi;
  /** Текст пункта: title задачи / текст обещания / текст плана из чек-ина. */
  title: string;
  /** Плановый срок (ISO). null для checkin-пунктов. */
  plannedDue: string | null;
  factStatus: WeeklyPersonItemFactStatusApi;
  /** «Что мешало» — ближайший блокер недели для overdue/missed, иначе null. */
  blockedBy: string | null;
}

/** Ответ drill-down: построчный план-факт по человеку за неделю. */
export interface WeeklyPersonItemsApi {
  personId: string;
  weekStart: string;
  weekEnd: string;
  items: WeeklyPersonItemApi[];
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

  /**
   * Построчный план-факт по одному человеку за неделю (drill-down раскрытия
   * строки в COO-виджете «Кто держит слово»). Operations-scope (RBAC: coo /
   * owner / admin / super_admin), как и `get`.
   */
  items: (weekStart: string, personId: string) => {
    const p = new URLSearchParams({ weekStart });
    return apiClient.get<WeeklyPersonItemsApi>(
      `/api/v1/dashboard/operations/weekly-per-person/${encodeURIComponent(
        personId,
      )}/items?${p.toString()}`,
    );
  },
};
