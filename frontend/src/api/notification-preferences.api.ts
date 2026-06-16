import { apiClient } from './api-client';

/** ТЗ coo-orphan-agents Ф8 — персональные настройки уведомлений (opt-out + тихие часы). */
export interface NotificationPreferencesApi {
  optOutEventTypes: string[];
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
}

export const notificationPreferencesApi = {
  get: () =>
    apiClient.get<NotificationPreferencesApi>('/api/v1/me/notification-preferences'),
  update: (body: {
    optOutEventTypes?: string[];
    quietHoursStart?: number;
    quietHoursEnd?: number;
  }) =>
    apiClient.patch<{ ok: true }>('/api/v1/me/notification-preferences', body),
};
