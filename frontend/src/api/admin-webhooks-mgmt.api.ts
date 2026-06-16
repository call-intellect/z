import { apiClient } from "./api-client";
import { buildQuery } from "./admin-helpers";
import type { WebhookDeliveriesPageApiDto } from "@/domain/admin-webhook-mgmt";

const BASE = "/api/v1/admin/integrations/webhooks-mgmt";

export type DeliveriesListRequest = {
  status?: "success" | "failed" | "pending";
  url?: string;
  cursor?: string;
  limit?: number;
};

export const adminWebhooksMgmtApi = {
  listActive: <T>() => apiClient.get<T>(`${BASE}/active`),

  listDeliveries: (
    req: DeliveriesListRequest = {},
  ): Promise<WebhookDeliveriesPageApiDto> =>
    apiClient.get<WebhookDeliveriesPageApiDto>(
      `${BASE}/deliveries${buildQuery(req)}`,
    ),

  listDlq: (
    req: { cursor?: string; limit?: number } = {},
  ): Promise<WebhookDeliveriesPageApiDto> =>
    apiClient.get<WebhookDeliveriesPageApiDto>(`${BASE}/dlq${buildQuery(req)}`),

  retryDelivery: (deliveryId: string): Promise<{ ok: true }> =>
    apiClient.post<{ ok: true }>(
      `${BASE}/dlq/${encodeURIComponent(deliveryId)}/retry`,
      {},
    ),
};
