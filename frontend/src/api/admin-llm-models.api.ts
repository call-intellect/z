import { apiClient } from "./api-client";
import { buildQuery } from "./admin-helpers";
import type {
  AdminLlmModelApi,
  AdminLlmModelListApi,
  AdminLlmModelPriceHistoryApi,
  CreateLlmModelRequest,
  ModelRemovalImpactApi,
  UpdateLlmModelRequest,
} from "@/domain/admin-llm-model";

export const adminLlmModelsApi = {
  list: (
    req: {
      providerId?: string;
      category?:
        | "flagship"
        | "fast"
        | "reasoning"
        | "embedding"
        | "experimental";
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
    apiClient.post<AdminLlmModelApi>("/api/v1/admin/llm-models", body),

  update: (id: string, body: UpdateLlmModelRequest) =>
    apiClient.patch<AdminLlmModelApi>(`/api/v1/admin/llm-models/${id}`, body),

  previewRemoval: (id: string) =>
    apiClient.get<ModelRemovalImpactApi>(
      `/api/v1/admin/llm-models/${id}/removal-impact`,
    ),

  setDefault: (id: string) =>
    apiClient.post<{ ok: true }>(`/api/v1/admin/llm-models/${id}/set-default`, {}),

  remove: (id: string, reassignDefaultModelTo?: string) =>
    apiClient.del<{ ok: true; routesMigrated: number }>(
      `/api/v1/admin/llm-models/${id}`,
      { body: reassignDefaultModelTo ? { reassignDefaultModelTo } : {} },
    ),
};
