/**
 * API-клиент календарного представления (Calendar MVP, Фаза 2).
 *
 * Контракт: `backend/src/modules/events/`.
 *
 * Эндпоинты:
 *   - POST   /api/v1/events
 *   - PATCH  /api/v1/events/:id
 *   - DELETE /api/v1/events/:id           (soft-cancel)
 *   - POST   /api/v1/events/:id/make-online (прицепить видеокомнату)
 *   - POST   /api/v1/events/:id/rsvp
 *   - GET    /api/v1/me/calendar?from=&to=
 *   - GET    /api/v1/users/:userId/calendar?from=&to=
 *   - POST   /api/v1/events/find-free-slot
 *
 * Защита: `CookieAuthGuard + TenantGuard`, RBAC `event_card.{read|write|delete}`.
 */

import { apiClient } from './api-client';

// ─────────────────────────── Enums ───────────────────────────────────

export type EventKindApi =
  | 'meeting'
  | 'incident'
  | 'release'
  | 'transition'
  | 'milestone'
  | 'call'
  | 'offline_meeting'
  | 'personal_block'
  | 'deadline'
  | 'other';

export type EventVisibilityApi = 'company' | 'team' | 'personal';
export type EventStatusApi = 'tentative' | 'confirmed' | 'cancelled';
export type RsvpStatusApi = 'pending' | 'accepted' | 'declined' | 'tentative';
export type RsvpActionApi = 'accepted' | 'declined' | 'tentative';
export type EventParticipantRoleApi = 'organizer' | 'required' | 'optional';
export type ReminderChannelApi = 'push' | 'email' | 'telegram';

// ─────────────────────────── Response shapes ─────────────────────────

export interface EventParticipantApi {
  id: string;
  userId: string | null;
  personId: string | null;
  role: EventParticipantRoleApi;
  rsvp: RsvpStatusApi;
  rsvpAt: string | null;
}

export interface EventReminderApi {
  id: string;
  offsetMin: number;
  channel: ReminderChannelApi;
  userId: string | null;
  sentAt: string | null;
}

export interface EventApi {
  id: string;
  entityId: string;
  kind: EventKindApi;
  title: string;
  startAt: string;
  endAt: string | null;
  durationMin: number | null;
  location: string | null;
  /**
   * ТЗ assistant-calendar-master Ф5/Ф8 — «о ком встреча»: клиент/контрагент или
   * компания. Отдельно от `location` (место проведения).
   */
  counterparty: string | null;
  /**
   * ТЗ assistant-calendar-master Ф6/Ф8 — формат встречи (онлайн ⇔ есть
   * видеокомната). Отделён от `kind` (тип). true → создана LiveKit-комната.
   */
  online: boolean;
  relatedMeetingId: string | null;
  /**
   * Calendar MVP Polish (P1, 2026-05-25). Публичная ссылка на LiveKit-комнату,
   * созданную автоматически для kind=meeting. null — для других kind или если
   * создание комнаты упало (фолбэк не блокирует событие).
   */
  joinUrl: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  participantsPersonIds: string[];
  outcomeSummary: string | null;
  metadata: Record<string, unknown> | null;
  // Calendar MVP поля
  ownerId: string | null;
  description: string | null;
  allDay: boolean;
  timezone: string;
  rrule: string | null;
  status: EventStatusApi;
  visibility: EventVisibilityApi;
  externalProvider: string | null;
  externalEventId: string | null;
  projectId: string | null;
  participants: EventParticipantApi[];
  reminders: EventReminderApi[];
}

export interface IssueCalendarItemApi {
  id: string;
  title: string;
  dueDate: string;
  projectId: string;
  projectName: string | null;
  priority: string;
  stateId: string | null;
}

export type CalendarItemApi =
  | { type: 'event'; event: EventApi }
  | { type: 'issue'; issue: IssueCalendarItemApi };

export interface CalendarResponseApi {
  items: CalendarItemApi[];
}

// ─────────────────────────── Request shapes ──────────────────────────

export interface ParticipantInputApi {
  userId?: string;
  personId?: string;
  role?: EventParticipantRoleApi;
}

export interface ReminderInputApi {
  offsetMin: number;
  channel: ReminderChannelApi;
  userId?: string | null;
}

export interface CreateEventRequestApi {
  title: string;
  startAt: string; // ISO-8601
  endAt?: string;
  kind: EventKindApi;
  visibility?: EventVisibilityApi;
  location?: string;
  counterparty?: string | null;
  online?: boolean;
  description?: string;
  allDay?: boolean;
  timezone?: string;
  rrule?: string;
  projectId?: string;
  participants?: ParticipantInputApi[];
  reminders?: ReminderInputApi[];
}

export interface UpdateEventRequestApi {
  title?: string;
  startAt?: string;
  endAt?: string | null;
  kind?: EventKindApi;
  visibility?: EventVisibilityApi;
  location?: string | null;
  counterparty?: string | null;
  online?: boolean;
  description?: string | null;
  allDay?: boolean;
  timezone?: string;
  rrule?: string | null;
  status?: EventStatusApi;
  projectId?: string | null;
}

export interface FindFreeSlotRequestApi {
  participantUserIds: string[];
  durationMin: number;
  withinDays?: number;
  workingHoursOnly?: boolean;
}

export interface FindFreeSlotResponseApi {
  slotStartAt: string | null;
  slotEndAt: string | null;
  found: boolean;
}

// ─────────────────────────── API client ──────────────────────────────

function buildRangeQuery(
  from?: string,
  to?: string,
  projectId?: string,
): string {
  const p = new URLSearchParams();
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  if (projectId) p.set('projectId', projectId);
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}

export const calendarApi = {
  /**
   * Мой календарь (события + задачи с dueDate).
   * @param projectId — Calendar MVP Polish (P3, 2026-05-25): серверный
   *   фильтр по проекту; раньше клиент фильтровал у себя.
   */
  getMyCalendar: (from?: string, to?: string, projectId?: string) =>
    apiClient.get<CalendarResponseApi>(
      `/api/v1/me/calendar${buildRangeQuery(from, to, projectId)}`,
    ),

  /** Календарь другого пользователя (personal-события маскированы). */
  getUserCalendar: (
    userId: string,
    from?: string,
    to?: string,
    projectId?: string,
  ) =>
    apiClient.get<CalendarResponseApi>(
      `/api/v1/users/${encodeURIComponent(userId)}/calendar${buildRangeQuery(from, to, projectId)}`,
    ),

  createEvent: (body: CreateEventRequestApi) =>
    apiClient.post<EventApi>('/api/v1/events', body),

  updateEvent: (id: string, body: UpdateEventRequestApi) =>
    apiClient.patch<EventApi>(
      `/api/v1/events/${encodeURIComponent(id)}`,
      body,
    ),

  cancelEvent: (id: string) =>
    apiClient.del<void>(`/api/v1/events/${encodeURIComponent(id)}`),

  /**
   * ТЗ assistant-calendar-master Ф6/Ф8 — прицепить видеокомнату к офлайн-встрече
   * задним числом: бэк создаёт LiveKit-комнату и переключает `online=true`.
   */
  makeEventOnline: (id: string) =>
    apiClient.post<EventApi>(
      `/api/v1/events/${encodeURIComponent(id)}/make-online`,
      {},
    ),

  rsvp: (id: string, status: RsvpActionApi) =>
    apiClient.post<EventApi>(
      `/api/v1/events/${encodeURIComponent(id)}/rsvp`,
      { status },
    ),

  findFreeSlot: (body: FindFreeSlotRequestApi) =>
    apiClient.post<FindFreeSlotResponseApi>(
      '/api/v1/events/find-free-slot',
      body,
    ),
};
