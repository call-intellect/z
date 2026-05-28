/**
 * API-клиент для onboarding-туров.
 *
 *   GET   /api/v1/users/me/tour-progress         — текущий прогресс
 *   PATCH /api/v1/users/me/tour-progress         — merge { tourId, completedAt?, skipped? }
 *   POST  /api/v1/users/me/tour-progress/reset   — обнулить
 *
 * Источник: plans/tz/2026-05-27-tracker-onboarding-tour.md.
 */

import { apiClient } from '../api-client';

/** ApiDto — сырые типы с бэка. Поле tourEntry опционально, может быть undefined. */
export interface TourEntryApi {
  completedAt?: string;
  skipped?: boolean;
}

export interface TourProgressApi {
  welcome?: TourEntryApi;
  project?: TourEntryApi;
  meeting?: TourEntryApi;
  overview?: TourEntryApi;
  demo?: TourEntryApi;
}

export type TourIdApi = 'welcome' | 'project' | 'meeting' | 'overview' | 'demo';

export interface UpdateTourProgressBodyApi {
  tourId: TourIdApi;
  completedAt?: string;
  skipped?: boolean;
}

export const tourProgressApi = {
  /** Загрузить текущий прогресс туров пользователя. */
  get: (): Promise<TourProgressApi> =>
    apiClient.get<TourProgressApi>('/api/v1/users/me/tour-progress'),

  /** Merge прогресса одного тура. */
  update: (body: UpdateTourProgressBodyApi): Promise<TourProgressApi> =>
    apiClient.patch<TourProgressApi>('/api/v1/users/me/tour-progress', body),

  /** Обнулить все туры (для кнопки «Показать тур заново»). */
  reset: (): Promise<{ ok: true }> =>
    apiClient.post<{ ok: true }>('/api/v1/users/me/tour-progress/reset', {}),
};
