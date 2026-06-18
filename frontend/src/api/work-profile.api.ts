import { apiClient } from './api-client';

/**
 * ТЗ assistant-calendar-master Ф8 — рабочий профиль пользователя:
 * таймзона + рабочие часы + рабочие дни. Единый источник «когда и в каком
 * поясе человек работает» (помощник Коры считает «сегодня/завтра» в этом TZ).
 *
 * Контракт: `GET/PATCH /api/v1/me/work-profile`.
 * `workingDays` — 0=вс..6=сб; `*IsCustom`/`*AreCustom` — задано пользователем
 * (false = значение взято из дефолтов AdminSetting).
 */
export interface WorkProfileApi {
  timezone: string;
  workStartHour: number;
  workEndHour: number;
  workingDays: number[];
  timezoneIsCustom: boolean;
  hoursAreCustom: boolean;
}

export const workProfileApi = {
  get: () => apiClient.get<WorkProfileApi>('/api/v1/me/work-profile'),
  update: (body: {
    timezone?: string;
    workStartHour?: number;
    workEndHour?: number;
    workingDays?: number[];
  }) => apiClient.patch<WorkProfileApi>('/api/v1/me/work-profile', body),
};
