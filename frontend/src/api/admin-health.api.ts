/**
 * API-клиент для health (Z-Admin Фаза 7).
 *
 * Контракт: `backend/src/modules/admin/controllers/admin-health.controller.ts`.
 */

import { apiClient } from './api-client';
import type { AdminHealthApi } from '@/domain/admin-health';

export const adminHealthApi = {
  get: () => apiClient.get<AdminHealthApi>('/api/v1/admin/health'),
};
