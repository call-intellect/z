import { apiClient } from "./api-client";
import { buildQuery } from "./admin-helpers";
import type {
  AdminLlmProviderApi,
  AdminLlmProviderListApi,
  CreateLlmProviderRequest,
  DiscoverModelsResultApi,
  RemovalImpactApi,
  SmokeTestResultApi,
  UpdateLlmProviderRequest,
} from "@/domain/admin-llm-provider";

export const adminLlmProvidersApi = {
  list: (req: { includeInactive?: boolean } = {}) =>
    apiClient.get<AdminLlmProviderListApi>(
      `/api/v1/admin/llm-providers${buildQuery({ includeInactive: req.includeInactive })}`,
    ),

  getById: (id: string) =>
    apiClient.get<AdminLlmProviderApi>(`/api/v1/admin/llm-providers/${id}`),

  create: (body: CreateLlmProviderRequest) =>
    apiClient.post<AdminLlmProviderApi>("/api/v1/admin/llm-providers", body),

  update: (id: string, body: UpdateLlmProviderRequest) =>
    apiClient.patch<AdminLlmProviderApi>(
      `/api/v1/admin/llm-providers/${id}`,
      body,
    ),

  remove: (id: string, reassignDefaultTo?: { providerId: string; model: string }) =>
    apiClient.del<{ ok: true; routesMigrated: number }>(
      `/api/v1/admin/llm-providers/${id}`,
      { body: reassignDefaultTo ? { reassignDefaultTo } : {} },
    ),

  previewRemoval: (id: string) =>
    apiClient.get<RemovalImpactApi>(
      `/api/v1/admin/llm-providers/${id}/removal-impact`,
    ),

  setDefault: (id: string, model: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/admin/llm-providers/${id}/set-default`,
      { model },
    ),

  smokeTest: (id: string) =>
    apiClient.post<SmokeTestResultApi>(
      `/api/v1/admin/llm-providers/${id}/smoke-test`,
      {},
    ),

  discoverModels: (id: string) =>
    apiClient.post<DiscoverModelsResultApi>(
      `/api/v1/admin/llm-providers/${id}/models/discover`,
      {},
    ),
};
