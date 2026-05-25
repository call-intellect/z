/**
 * API-клиент календарного представления (Calendar MVP, Фаза 2).
 *
 * Контракт: `backend/src/modules/events/`.
 *
 * Эндпоинты:
 *   - POST   /api/v1/events
 *   - PATCH  /api/v1/events/:id
 *   - DELETE /api/v1/events/:id           (soft-cancel)
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
  relatedMeetingId: string | null;
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

function buildRangeQuery(from?: string, to?: string): string {
  const p = new URLSearchParams();
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}

export const calendarApi = {
  /** Мой календарь (события + задачи с dueDate). */
  getMyCalendar: (from?: string, to?: string) =>
    apiClient.get<CalendarResponseApi>(
      `/api/v1/me/calendar${buildRangeQuery(from, to)}`,
    ),

  /** Календарь другого пользователя (personal-события маскированы). */
  getUserCalendar: (userId: string, from?: string, to?: string) =>
    apiClient.get<CalendarResponseApi>(
      `/api/v1/users/${encodeURIComponent(userId)}/calendar${buildRangeQuery(from, to)}`,
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
