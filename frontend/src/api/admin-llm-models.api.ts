/**
 * SBA α-10 wave 3 — API-клиент для admin LLM models registry.
 */
import { apiClient } from './api-client';
import { buildQuery } from './admin-helpers';
import type {
  AdminLlmModelApi,
  AdminLlmModelListApi,
  AdminLlmModelPriceHistoryApi,
  CreateLlmModelRequest,
  UpdateLlmModelRequest,
} from '@/domain/admin-llm-model';

export const adminLlmModelsApi = {
  list: (
    req: {
      providerId?: string;
      category?:
        | 'flagship'
        | 'fast'
        | 'reasoning'
        | 'embedding'
        | 'experimental';
      includeInactive?: boolean;
    } = {},
  ) =>
    apiClient.get<AdminLlmModelListApi>(
      `/api/v1/admin/llm-models${buildQuery({
        providerId: req.providerId,
        category: req.category,
        includeInactive: req.includeInactive,
      })}`,
    ),

  getById: (id: string) =>
    apiClient.get<AdminLlmModelApi>(`/api/v1/admin/llm-models/${id}`),

  priceHistory: (id: string) =>
    apiClient.get<AdminLlmModelPriceHistoryApi>(
      `/api/v1/admin/llm-models/${id}/price-history`,
    ),

  create: (body: CreateLlmModelRequest) =>
    apiClient.post<AdminLlmModelApi>('/api/v1/admin/llm-models', body),

  update: (id: string, body: UpdateLlmModelRequest) =>
    apiClient.patch<AdminLlmModelApi>(`/api/v1/admin/llm-models/${id}`, body),

  remove: (id: string) =>
    apiClient.del<{ ok: true }>(`/api/v1/admin/llm-models/${id}`),
};
