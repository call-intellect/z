import { apiClient } from "./api-client";

export type ProactiveSeverityApi = "low" | "medium" | "high";
export type ProactiveSeverity = ProactiveSeverityApi;

export type ProactiveNotificationApi = {
  id: string;
  ruleType: string;
  severity: ProactiveSeverityApi;
  payload: unknown;
  notificationId: string | null;
  emittedAt: string;
  dismissedAt: string | null;
};

export type ListProactiveResponseApi = {
  items: ProactiveNotificationApi[];
};

export async function listMyProactiveNotifications(
  orgId: string,
  options?: { includeDismissed?: boolean; limit?: number },
): Promise<ListProactiveResponseApi> {
  const search = new URLSearchParams();
  if (options?.includeDismissed) search.set("includeDismissed", "true");
  if (options?.limit) search.set("limit", String(options.limit));
  const qs = search.toString();
  return apiClient.get<ListProactiveResponseApi>(
    `/api/v1/me/proactive-notifications${qs ? `?${qs}` : ""}`,
    { headers: { "X-Org-Id": orgId } },
  );
}

export async function dismissProactiveNotification(
  orgId: string,
  id: string,
): Promise<ProactiveNotificationApi> {
  return apiClient.post<ProactiveNotificationApi>(
    `/api/v1/me/proactive-notifications/${id}/dismiss`,
    {},
    { headers: { "X-Org-Id": orgId } },
  );
}

export const proactiveApi = {
  list: (orgId: string, options?: { limit?: number }) =>
    listMyProactiveNotifications(orgId, {
      limit: options?.limit ?? 50,
    }),
  dismiss: (orgId: string, id: string) =>
    dismissProactiveNotification(orgId, id),
};
