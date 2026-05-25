/**
 * API-клиент для `/admin/content/system-messages` — Z-Admin Фаза 5.
 *
 * Контракт сервера: `backend/src/modules/admin/content/system-messages/...`
 * (префикс `/api/v1/admin/content/system-messages`).
 */

import { apiClient } from './api-client';
import type {
  CreateSystemMessageRequest,
  SystemMessageItemApi,
  SystemMessageListApi,
  UpdateSystemMessageRequest,
} from '@/domain/admin-system-message';

export const adminSystemMessagesApi = {
  list: () =>
    apiClient.get<SystemMessageListApi>(
      '/api/v1/admin/content/system-messages',
    ),

  create: (body: CreateSystemMessageRequest) =>
    apiClient.post<SystemMessageItemApi>(
      '/api/v1/admin/content/system-messages',
      body,
    ),

  update: (id: string, body: UpdateSystemMessageRequest) =>
    apiClient.patch<SystemMessageItemApi>(
      `/api/v1/admin/content/system-messages/${encodeURIComponent(id)}`,
      body,
    ),

  remove: (id: string) =>
    apiClient.del<{ ok: true }>(
      `/api/v1/admin/content/system-messages/${encodeURIComponent(id)}`,
    ),
};
