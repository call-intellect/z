import { apiClient } from "./api-client";
import type {
  StorageOverviewApiDto,
  StorageProviderApi,
} from "@/domain/admin-storage";

const BASE = "/api/v1/admin/media/storage";

export const adminStorageApi = {
  overview: (): Promise<StorageOverviewApiDto> =>
    apiClient.get<StorageOverviewApiDto>(BASE),

  switchProvider: (
    provider: StorageProviderApi,
    reason: string,
  ): Promise<{ ok: true }> =>
    apiClient.post<{ ok: true }>(`${BASE}/switch`, { provider, reason }),
};
