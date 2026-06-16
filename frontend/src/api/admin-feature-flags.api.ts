import { apiClient } from "./api-client";
import type {
  FeatureFlagApiDto,
  FeatureFlagListApiDto,
  FeatureFlagResolveApiDto,
  UpdateFeatureFlagRequest,
  UpsertFeatureFlagRequest,
} from "@/domain/admin-feature-flag";

const BASE = "/api/v1/admin/platform/feature-flags";

export const adminFeatureFlagsApi = {
  list: (): Promise<FeatureFlagListApiDto> =>
    apiClient.get<FeatureFlagListApiDto>(BASE),

  create: (body: UpsertFeatureFlagRequest): Promise<FeatureFlagApiDto> =>
    apiClient.post<FeatureFlagApiDto>(BASE, body),

  update: (
    key: string,
    body: UpdateFeatureFlagRequest,
  ): Promise<FeatureFlagApiDto> =>
    apiClient.patch<FeatureFlagApiDto>(
      `${BASE}/${encodeURIComponent(key)}`,
      body,
    ),

  remove: (key: string): Promise<{ ok: true }> =>
    apiClient.del<{ ok: true }>(`${BASE}/${encodeURIComponent(key)}`),

  resolve: (
    key: string,
    tenantId?: string,
  ): Promise<FeatureFlagResolveApiDto> => {
    const q = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
    return apiClient.get<FeatureFlagResolveApiDto>(
      `${BASE}/${encodeURIComponent(key)}/resolve${q}`,
    );
  },
};
