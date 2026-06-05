import { apiClient } from './api-client';

// ──────────────────────── ApiDto ────────────────────────

export type ChannelKindApi =
  | 'in_app'
  | 'email_smtp'
  | 'email_imap'
  | 'telegram_bot'
  | 'max_bot';

export type DataClassApi = 'public' | 'internal' | 'sensitive' | 'private';

export type ChannelApi = {
  id: string;
  kind: ChannelKindApi;
  direction: 'inbound_only' | 'outbound_only' | 'bidirectional';
  status: 'active' | 'disabled' | 'broken';
  maxDataClass: DataClassApi;
  /** Б2 (2026-06-05) — только для бот-каналов: настроен ли токен. */
  configured?: boolean;
  /** Б2 — username бота для deep-link (из Channel.config). */
  botUsername?: string | null;
};

export type ChannelBindingApi = {
  id: string;
  externalId: string;
  verifiedAt: string | null;
  preferences: ChannelBindingPreferencesApi | null;
  /** W4.3 — потолок чувствительности per-binding (radio в /me/channels). */
  maxDataClass: DataClassApi;
};

export type ChannelBindingPreferencesApi = {
  quietHours?: string;
  eventTypeAllow?: string[];
  eventTypeDeny?: string[];
  rateLimitPerHour?: number;
  disabledUntil?: string;
};

export type ChannelEntryApi = {
  channel: ChannelApi;
  binding: ChannelBindingApi | null;
};

export type NotificationStatusApi =
  | 'queued'
  | 'sent_partial'
  | 'delivered'
  | 'read'
  | 'responded'
  | 'failed';

export type NotificationResponseStatusApi =
  | 'pending'
  | 'answered'
  | 'dismissed'
  | 'expired'
  | null;

export type NotificationApi = {
  id: string;
  eventType: string;
  payload: unknown;
  dataClass: DataClassApi;
  contextBlockId: string | null;
  contextCardId: string | null;
  status: NotificationStatusApi;
  responseStatus: NotificationResponseStatusApi;
  responsePayload: unknown;
  expiresAt: string | null;
  createdAt: string;
  respondedAt: string | null;
};

export type NotificationDeliveryApi = {
  id: string;
  channelBindingId: string;
  status: string;
  attempts: number;
  attemptedAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  respondedAt: string | null;
  errorReason: string | null;
};

export type NotificationDetailApi = NotificationApi & {
  deliveries: NotificationDeliveryApi[];
};

export type ListNotificationsResponseApi = {
  items: NotificationApi[];
  nextCursor: string | null;
};

export type LinkCodeKindApi =
  | 'email_smtp'
  | 'email_imap'
  | 'telegram_bot'
  | 'max_bot';

// ──────────────────────── API calls ────────────────────────

export async function listMyChannels(
  orgId: string,
): Promise<{ items: ChannelEntryApi[] }> {
  return apiClient.get<{ items: ChannelEntryApi[] }>('/api/v1/me/channels', {
    headers: { 'X-Org-Id': orgId },
  });
}

export async function generateLinkCode(
  kind: LinkCodeKindApi,
): Promise<{ code: string; ttlSec: number }> {
  return apiClient.post<{ code: string; ttlSec: number }>(
    `/api/v1/me/channels/${kind}/link-code`,
    {},
  );
}

export async function updateBindingPreferences(
  bindingId: string,
  preferences: ChannelBindingPreferencesApi,
): Promise<{ id: string; preferences: ChannelBindingPreferencesApi }> {
  return apiClient.patch<{ id: string; preferences: ChannelBindingPreferencesApi }>(
    `/api/v1/me/channels/bindings/${bindingId}/preferences`,
    preferences,
  );
}

export async function unlinkChannelBinding(bindingId: string): Promise<void> {
  await apiClient.del<void>(`/api/v1/me/channels/bindings/${bindingId}`);
}

/**
 * W4.3 — обновить потолок чувствительности привязки.
 * `private` через UI недоступен (см. §W4.3 ТЗ).
 */
export async function updateBindingMaxDataClass(
  bindingId: string,
  maxDataClass: 'public' | 'internal' | 'sensitive',
): Promise<{ id: string; maxDataClass: DataClassApi }> {
  return apiClient.patch<{ id: string; maxDataClass: DataClassApi }>(
    `/api/v1/me/channels/bindings/${bindingId}/max-data-class`,
    { maxDataClass },
  );
}

export async function listMyNotifications(
  orgId: string,
  query?: {
    status?: 'unread' | 'all' | 'pending_response';
    limit?: number;
    cursor?: string;
  },
): Promise<ListNotificationsResponseApi> {
  const search = new URLSearchParams();
  if (query?.status) search.set('status', query.status);
  if (query?.limit) search.set('limit', String(query.limit));
  if (query?.cursor) search.set('cursor', query.cursor);
  const qs = search.toString();
  return apiClient.get<ListNotificationsResponseApi>(
    `/api/v1/me/notifications${qs ? `?${qs}` : ''}`,
    { headers: { 'X-Org-Id': orgId } },
  );
}

export async function getMyNotification(
  orgId: string,
  notificationId: string,
): Promise<NotificationDetailApi> {
  return apiClient.get<NotificationDetailApi>(
    `/api/v1/me/notifications/${notificationId}`,
    { headers: { 'X-Org-Id': orgId } },
  );
}

export async function respondToNotification(
  notificationId: string,
  payload: Record<string, unknown>,
): Promise<NotificationApi> {
  return apiClient.post<NotificationApi>(
    `/api/v1/me/notifications/${notificationId}/respond`,
    { payload },
  );
}

export async function dismissNotification(
  notificationId: string,
): Promise<NotificationApi> {
  return apiClient.post<NotificationApi>(
    `/api/v1/me/notifications/${notificationId}/dismiss`,
    {},
  );
}

export async function markNotificationRead(
  notificationId: string,
): Promise<void> {
  await apiClient.post<void>(
    `/api/v1/me/notifications/${notificationId}/read`,
    {},
  );
}

export async function createFreeNote(
  orgId: string,
  text: string,
  metadata?: Record<string, unknown>,
): Promise<{ rawEventId: string; occurredAt: string }> {
  return apiClient.post<{ rawEventId: string; occurredAt: string }>(
    '/api/v1/me/notifications/free-note',
    { text, metadata },
    { headers: { 'X-Org-Id': orgId } },
  );
}
