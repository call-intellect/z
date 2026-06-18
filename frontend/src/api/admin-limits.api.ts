import { apiClient } from "./api-client";

const BASE = "/api/v1/admin/platform/limits";

export const adminLimitsApi = {
  list: (): Promise<{ items: Array<{ key: string; value: unknown }> }> =>
    apiClient.get<{ items: Array<{ key: string; value: unknown }> }>(BASE),
};
