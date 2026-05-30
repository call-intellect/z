import { apiClient } from './api-client';

// ──────────────────────── ApiDto ────────────────────────

export type ProactiveSeverityApi = 'low' | 'medium' | 'high';
/** Алиас для Pulse §9 — короткое имя в новых местах использования. */
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

// ──────────────────────── API calls ────────────────────────

/**
 * SBA δ-2 — список проактивных уведомлений текущего user'а.
 * По дефолту скрывает dismissed; пасс `includeDismissed=true` для всех.
 */
export async function listMyProactiveNotifications(
  orgId: string,
  options?: { includeDismissed?: boolean; limit?: number },
): Promise<ListProactiveResponseApi> {
  const search = new URLSearchParams();
  if (options?.includeDismissed) search.set('includeDismissed', 'true');
  if (options?.limit) search.set('limit', String(options.limit));
  const qs = search.toString();
  return apiClient.get<ListProactiveResponseApi>(
    `/api/v1/me/proactive-notifications${qs ? `?${qs}` : ''}`,
    { headers: { 'X-Org-Id': orgId } },
  );
}

/**
 * SBA δ-2 — пометить проактивное уведомление как скрытое.
 * Идемпотентно: повторный вызов — no-op (возвращает уже-dismissed запись).
 */
export async function dismissProactiveNotification(
  orgId: string,
  id: string,
): Promise<ProactiveNotificationApi> {
  return apiClient.post<ProactiveNotificationApi>(
    `/api/v1/me/proactive-notifications/${id}/dismiss`,
    {},
    { headers: { 'X-Org-Id': orgId } },
  );
}

// ──────────────────────── proactiveApi (Pulse §9 — AssistantSidebar) ────────────────────────

/**
 * Pulse §9 — Sidebar Помощник.
 *
 * Объектный фасад для использования в `AssistantSidebar` (правый floating-panel,
 * polling 60 сек). orgId обязателен — фронт берёт из `useAuth().currentOrgId`,
 * бэк требует X-Org-Id для resolve тенанта.
 */
export const proactiveApi = {
  list: (orgId: string, options?: { limit?: number }) =>
    listMyProactiveNotifications(orgId, {
      limit: options?.limit ?? 50,
    }),
  dismiss: (orgId: string, id: string) =>
    dismissProactiveNotification(orgId, id),
};
