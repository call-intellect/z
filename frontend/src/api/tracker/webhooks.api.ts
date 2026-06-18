import { apiClient } from "../api-client";
import { buildQuery, orgHeaders } from "../admin-helpers";
import type {
  WebhookApi,
  WebhookLogsResponseApi,
  WebhookTestEnqueueResultApi,
  WebhookEvent,
} from "@/domain/tracker";

export interface CreateWebhookRequest {
  name: string;
  url: string;
  events: WebhookEvent[];
  isActive?: boolean;
  isInternal?: boolean;
}

export interface UpdateWebhookRequest {
  name?: string;
  url?: string;
  events?: WebhookEvent[];
  isActive?: boolean;
  isInternal?: boolean;
}

export interface WebhookLogsRequest {
  page?: number;
  limit?: number;
  success?: boolean;
  since?: string;
  until?: string;
  eventType?: string;
}

export const webhooksApi = {
  list: (orgId: string) =>
    apiClient.get<WebhookApi[]>("/api/v1/tracker/webhooks", {
      headers: orgHeaders(orgId),
    }),

  create: (orgId: string, body: CreateWebhookRequest) =>
    apiClient.post<WebhookApi>("/api/v1/tracker/webhooks", body, {
      headers: orgHeaders(orgId),
    }),

  update: (orgId: string, webhookId: string, body: UpdateWebhookRequest) =>
    apiClient.patch<WebhookApi>(
      `/api/v1/tracker/webhooks/${encodeURIComponent(webhookId)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  remove: (orgId: string, webhookId: string) =>
    apiClient.del<void>(
      `/api/v1/tracker/webhooks/${encodeURIComponent(webhookId)}`,
      { headers: orgHeaders(orgId) },
    ),

  logs: (orgId: string, webhookId: string, req: WebhookLogsRequest = {}) =>
    apiClient.get<WebhookLogsResponseApi>(
      `/api/v1/tracker/webhooks/${encodeURIComponent(webhookId)}/logs${buildQuery(
        {
          ...req,
        },
      )}`,
      { headers: orgHeaders(orgId) },
    ),

  test: (orgId: string, webhookId: string) =>
    apiClient.post<WebhookTestEnqueueResultApi>(
      `/api/v1/tracker/webhooks/${encodeURIComponent(webhookId)}/test`,
      undefined,
      { headers: orgHeaders(orgId) },
    ),
};
