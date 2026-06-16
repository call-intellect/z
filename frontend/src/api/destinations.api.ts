import { apiClient } from "./api-client";

export type DestinationType =
  | "email"
  | "slack_webhook"
  | "telegram_bot"
  | "generic_webhook";

export type DestinationConfigView = {
  recipient_email?: string;
  url_present?: true;
  bot_token_present?: true;
  chat_id?: string | number;
  [key: string]: unknown;
};

export type DestinationApi = {
  id: string;
  type: DestinationType;
  name: string;
  config: DestinationConfigView;
  createdAt: string;
  updatedAt: string;
};

export type DestinationsListApiResponse = { items: DestinationApi[] };

export type CreateDestinationRequest =
  | {
      type: "email";
      name: string;
      config: { recipient_email: string };
    }
  | {
      type: "slack_webhook";
      name: string;
      config: { url: string };
    }
  | {
      type: "telegram_bot";
      name: string;
      config: { bot_token: string; chat_id: string | number };
    }
  | {
      type: "generic_webhook";
      name: string;
      config: { url: string };
    };

export type UpdateDestinationRequest = {
  name?: string;
  config?: Record<string, unknown>;
};

export const destinationsApi = {
  list: () =>
    apiClient.get<DestinationsListApiResponse>("/api/v1/destinations"),

  create: (body: CreateDestinationRequest) =>
    apiClient.post<DestinationApi>("/api/v1/destinations", body),

  update: (id: string, body: UpdateDestinationRequest) =>
    apiClient.patch<DestinationApi>(
      `/api/v1/destinations/${encodeURIComponent(id)}`,
      body,
    ),

  remove: (id: string) =>
    apiClient.del<void>(`/api/v1/destinations/${encodeURIComponent(id)}`),

  test: (id: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/destinations/${encodeURIComponent(id)}/test`,
    ),
};
