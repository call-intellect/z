import { apiClient } from "./client";
import type { PushTransport } from "./config";

export interface RegisterPushBody {
  transport: PushTransport;
  token: string;
  deviceInfo?: Record<string, string>;
}

export const pushApi = {
  register: (body: RegisterPushBody) =>
    apiClient.post<{ ok: true }>("/api/v1/push/tokens", body),

  unregister: (token: string, transport: PushTransport) =>
    apiClient.del<{ ok: true }>("/api/v1/push/tokens", { token, transport }),
};
