import { apiClient } from "./api-client";

export type WebhookStatus = "active" | "paused" | "failing";

export type WebhookSubscriptionApi = {
  id: string;
  url: string;
  events: string[];
  status: WebhookStatus;
  secretPrefix: string;
  lastDeliveryAt: string | null;
  createdAt: string;
};

export type WebhookSubscriptionsListApiResponse = {
  items: WebhookSubscriptionApi[];
};

export type CreateWebhookSubscriptionRequest = {
  url: string;
  events: string[];
};

export type CreateWebhookSubscriptionApiResponse = {
  subscription: WebhookSubscriptionApi;
  secret: string;
};

export type DeliveryStatus = "pending" | "retrying" | "delivered" | "failed";

export type WebhookDeliveryApi = {
  id: string;
  subscriptionId: string;
  event: string;
  eventId: string;
  payload: unknown;
  attempts: number;
  lastStatus: number | null;
  lastResponse: string | null;
  status: DeliveryStatus;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
};

export type WebhookDeliveriesListApiResponse = {
  items: WebhookDeliveryApi[];
};

export const WEBHOOK_EVENTS = [
  "meeting.completed",
  "meeting.regenerated",
  "meeting.deleted",
  "task.created",
  "task.updated",
  "task.deleted",
  "highlight.created",
  "highlight.rendered",
  "share.created",
  "share.viewed",
  "export.completed",
  "chat.completed",
] as const;

export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number];

export const webhooksOutApi = {
  list: () =>
    apiClient.get<WebhookSubscriptionsListApiResponse>(
      "/api/v1/webhooks/subscriptions",
    ),

  create: (body: CreateWebhookSubscriptionRequest) =>
    apiClient.post<CreateWebhookSubscriptionApiResponse>(
      "/api/v1/webhooks/subscriptions",
      body,
    ),

  remove: (id: string) =>
    apiClient.del<void>(
      `/api/v1/webhooks/subscriptions/${encodeURIComponent(id)}`,
    ),

  deliveries: (id: string) =>
    apiClient.get<WebhookDeliveriesListApiResponse>(
      `/api/v1/webhooks/subscriptions/${encodeURIComponent(id)}/deliveries`,
    ),

  test: (id: string) =>
    apiClient.post<{ deliveryId: string }>(
      `/api/v1/webhooks/subscriptions/${encodeURIComponent(id)}/test`,
    ),
};
