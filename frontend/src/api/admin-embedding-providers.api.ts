import { apiClient } from "./api-client";
import { buildQuery } from "./admin-helpers";
import type {
  AdminEmbeddingProviderApi,
  AdminEmbeddingProviderListApi,
  CreateEmbeddingModelRequest,
  CreateEmbeddingProviderRequest,
  EmbeddingSmokeResultApi,
  UpdateEmbeddingModelRequest,
  UpdateEmbeddingProviderRequest,
} from "@/domain/admin-embedding-provider";

const BASE = "/api/v1/admin/embedding-providers";

export const adminEmbeddingProvidersApi = {
  list: (req: { includeInactive?: boolean } = {}) =>
    apiClient.get<AdminEmbeddingProviderListApi>(
      `${BASE}${buildQuery({ includeInactive: req.includeInactive })}`,
    ),

  getById: (id: string) =>
    apiClient.get<AdminEmbeddingProviderApi>(`${BASE}/${id}`),

  create: (body: CreateEmbeddingProviderRequest) =>
    apiClient.post<AdminEmbeddingProviderApi>(BASE, body),

  update: (id: string, body: UpdateEmbeddingProviderRequest) =>
    apiClient.patch<AdminEmbeddingProviderApi>(`${BASE}/${id}`, body),

  remove: (id: string) => apiClient.del<{ ok: true }>(`${BASE}/${id}`),

  activate: (id: string) =>
    apiClient.post<AdminEmbeddingProviderApi>(`${BASE}/${id}/activate`, {}),

  smoke: (id: string) =>
    apiClient.post<EmbeddingSmokeResultApi>(`${BASE}/${id}/smoke`, {}),

  addModel: (providerId: string, body: CreateEmbeddingModelRequest) =>
    apiClient.post<AdminEmbeddingProviderApi>(
      `${BASE}/${providerId}/models`,
      body,
    ),

  updateModel: (
    providerId: string,
    modelId: string,
    body: UpdateEmbeddingModelRequest,
  ) =>
    apiClient.patch<AdminEmbeddingProviderApi>(
      `${BASE}/${providerId}/models/${modelId}`,
      body,
    ),

  removeModel: (providerId: string, modelId: string) =>
    apiClient.del<{ ok: true }>(`${BASE}/${providerId}/models/${modelId}`),
};
