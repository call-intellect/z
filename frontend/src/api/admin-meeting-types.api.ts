/**
 * API-клиент для `/admin/content/meeting-types` — Z-Admin Фаза 5.
 *
 * Контракт сервера: `backend/src/modules/admin/content/meeting-types/
 * meeting-types-admin.controller.ts` (префикс
 * `/api/v1/admin/content/meeting-types`).
 */

import { apiClient } from './api-client';
import type {
  CreateMeetingTypeRequest,
  MeetingTypeItemApi,
  MeetingTypeListApi,
  UpdateMeetingTypeRequest,
} from '@/domain/admin-meeting-type';

export const adminMeetingTypesApi = {
  list: () =>
    apiClient.get<MeetingTypeListApi>('/api/v1/admin/content/meeting-types'),

  create: (body: CreateMeetingTypeRequest) =>
    apiClient.post<MeetingTypeItemApi>(
      '/api/v1/admin/content/meeting-types',
      body,
    ),

  update: (id: string, body: UpdateMeetingTypeRequest) =>
    apiClient.patch<MeetingTypeItemApi>(
      `/api/v1/admin/content/meeting-types/${encodeURIComponent(id)}`,
      body,
    ),

  /** Soft-delete: бэкенд выставит isActive=false. */
  remove: (id: string) =>
    apiClient.del<{ ok: true }>(
      `/api/v1/admin/content/meeting-types/${encodeURIComponent(id)}`,
    ),
};
