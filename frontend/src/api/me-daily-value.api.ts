/**
 * API-клиент self-scope виджетов «ежедневной ценности» в `/me`
 * (ТЗ-2 Ф5 daily-value-dashboards).
 *
 * Эндпоинты — см. `backend/src/modules/operations/controllers`:
 *   - `MyDailyValueController`     → GET /api/v1/me/ideas, GET /api/v1/me/recognitions
 *   - `MyWeeklyPerPersonController` → GET /api/v1/me/weekly-per-person?weekStart=
 *
 * Все три — self-scope (данные только текущего пользователя), гейтятся
 * kill-switch на бэке (OFF → пустой ответ 200). Tenant резолвится из
 * дефолтного `X-Org-Id` (apiClient ставит сам).
 */

import { apiClient } from './api-client';
import type { IdeaListItemApi } from './ideas.api';

/**
 * Ответ `GET /api/v1/me/ideas` — судьба моих идей (как автора).
 * `items` прокидываются из `IdeasService.listMine({ role: 'author' })`.
 * Источник правды: `backend/.../dto/my-daily-value.dto.ts:MyIdeasResponseDto`.
 */
export interface MyIdeasResponseApi {
  items: IdeaListItemApi[];
}

/**
 * Одно полученное признание. `type` НЕ переведён бэком — карту лейблов
 * делает фронт (`src/domain/me-daily-value.ts`). `fromPersonName` — имя
 * дарителя (null если от AI/системы).
 * Источник правды: `backend/.../dto/my-daily-value.dto.ts:MyRecognitionDto`.
 */
export interface MyRecognitionApi {
  id: string;
  type: string;
  message: string | null;
  fromPersonName: string | null;
  visibility: string;
  createdAt: string;
}

/** Ответ `GET /api/v1/me/recognitions`. */
export interface MyRecognitionsResponseApi {
  items: MyRecognitionApi[];
}

/**
 * Строка self-view недельного план-факта (только моя). Зеркалирует
 * `WeeklyPersonRowDto` из `backend/.../dto/weekly-per-person.dto.ts`.
 */
export interface MyWeeklyPersonRowApi {
  personId: string;
  personName: string;
  departmentName: string | null;
  promisesGiven: number;
  promisesKept: number;
  promisesBroken: number;
  promisesOverdue: number;
  /** Обещания со статусом «спросили», на которые ещё нет ответа. */
  promisesNoAnswer: number;
  /**
   * kept / (kept+broken+overdue) * 100. null в ДВУХ случаях: знаменатель=0
   * (обещаний нет) ИЛИ знаменатель меньше минимума («мало данных»). Чтобы
   * отличить — фронт сам считает знаменатель kept+broken+overdue.
   */
  reliabilityPercent: number | null;
  tasksDone: number;
  checkInsCompleted: number;
}

/**
 * Ответ `GET /api/v1/me/weekly-per-person?weekStart=YYYY-MM-DD`.
 * Зеркалирует `MyWeeklyPerPersonDto`. `row=null` — у пользователя нет
 * Person-записи или флаг OFF. `teamAverageReliabilityPercent` — среднее по
 * команде (для стрелки «я vs команда»), null если нет достоверных строк.
 */
export interface MyWeeklyPerPersonApi {
  weekStart: string;
  weekEnd: string;
  row: MyWeeklyPersonRowApi | null;
  teamAverageReliabilityPercent: number | null;
}

export const meDailyValueApi = {
  /** Судьба моих идей (self-scope: только мои идеи как автора). */
  ideas: () => apiClient.get<MyIdeasResponseApi>('/api/v1/me/ideas'),

  /** Мои полученные признания (self-scope: toUserId = я). */
  recognitions: () =>
    apiClient.get<MyRecognitionsResponseApi>('/api/v1/me/recognitions'),

  /**
   * Мой недельный план-факт (self-scope: моя строка + среднее команды).
   * `weekStart` — понедельник недели (YYYY-MM-DD).
   */
  weeklyPerPerson: (weekStart: string) =>
    apiClient.get<MyWeeklyPerPersonApi>(
      `/api/v1/me/weekly-per-person?weekStart=${encodeURIComponent(weekStart)}`,
    ),
};
