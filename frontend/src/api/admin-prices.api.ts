/**
 * API-клиент для прайс-карты LLM (Z-Admin Фаза 7).
 *
 * Контракт: `backend/src/modules/admin/controllers/admin-prices.controller.ts`.
 */

import { apiClient } from './api-client';
import { buildQuery } from './admin-helpers';
import type { AdminPriceListApi, SetPriceRequest } from '@/domain/admin-price';

export type ListPricesRequest = {
  activeOnly?: boolean;
};

export const adminPricesApi = {
  list: (req: ListPricesRequest = {}) =>
    apiClient.get<AdminPriceListApi>(
      `/api/v1/admin/llm-prices${buildQuery({ activeOnly: req.activeOnly })}`,
    ),

  set: (body: SetPriceRequest) =>
    apiClient.post<{ ok: true }>('/api/v1/admin/llm-prices', body),
};
