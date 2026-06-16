import { apiClient } from "./api-client";

export type EventKindApi =
  | "meeting"
  | "incident"
  | "release"
  | "transition"
  | "milestone"
  | "call"
  | "offline_meeting"
  | "personal_block"
  | "deadline"
  | "other";

export type EventVisibilityApi = "company" | "team" | "personal";
export type EventStatusApi = "tentative" | "confirmed" | "cancelled";
export type RsvpStatusApi = "pending" | "accepted" | "declined" | "tentative";
export type RsvpActionApi = "accepted" | "declined" | "tentative";
export type EventParticipantRoleApi = "organizer" | "required" | "optional";
export type ReminderChannelApi = "push" | "email" | "telegram";

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
  joinUrl: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  participantsPersonIds: string[];
  outcomeSummary: string | null;
  metadata: Record<string, unknown> | null;
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
  | { type: "event"; event: EventApi }
  | { type: "issue"; issue: IssueCalendarItemApi };

export interface CalendarResponseApi {
  items: CalendarItemApi[];
}

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
  startAt: string;
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

function buildRangeQuery(
  from?: string,
  to?: string,
  projectId?: string,
): string {
  const p = new URLSearchParams();
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  if (projectId) p.set("projectId", projectId);
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

export const calendarApi = {
  getMyCalendar: (from?: string, to?: string, projectId?: string) =>
    apiClient.get<CalendarResponseApi>(
      `/api/v1/me/calendar${buildRangeQuery(from, to, projectId)}`,
    ),

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
    apiClient.post<EventApi>("/api/v1/events", body),

  updateEvent: (id: string, body: UpdateEventRequestApi) =>
    apiClient.patch<EventApi>(`/api/v1/events/${encodeURIComponent(id)}`, body),

  cancelEvent: (id: string) =>
    apiClient.del<void>(`/api/v1/events/${encodeURIComponent(id)}`),

  rsvp: (id: string, status: RsvpActionApi) =>
    apiClient.post<EventApi>(`/api/v1/events/${encodeURIComponent(id)}/rsvp`, {
      status,
    }),

  findFreeSlot: (body: FindFreeSlotRequestApi) =>
    apiClient.post<FindFreeSlotResponseApi>(
      "/api/v1/events/find-free-slot",
      body,
    ),
};
