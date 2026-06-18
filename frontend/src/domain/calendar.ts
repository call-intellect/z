import type {
  CalendarItemApi,
  EventApi,
  EventKindApi,
  EventParticipantApi,
  EventStatusApi,
  EventVisibilityApi,
  IssueCalendarItemApi,
  ReminderChannelApi,
  RsvpStatusApi,
} from '@/api/calendar.api';

export const EVENT_KIND_LABELS: Record<EventKindApi, string> = {
  meeting: 'Встреча',
  call: 'Созвон',
  offline_meeting: 'Очная встреча',
  personal_block: 'Личное время',
  deadline: 'Дедлайн',
  milestone: 'Веха',
  incident: 'Инцидент',
  release: 'Релиз',
  transition: 'Переход',
  other: 'Другое',
};

export const EVENT_VISIBILITY_LABELS: Record<EventVisibilityApi, string> = {
  company: 'Видна всем',
  team: 'Только команде',
  personal: 'Личное',
};

export const RSVP_LABELS: Record<RsvpStatusApi, string> = {
  pending: 'Ждёт ответа',
  accepted: 'Подтвердил',
  declined: 'Отказался',
  tentative: 'Возможно',
};

export interface EventKindStyle {
  bg: string;
  border: string;
  text: string;
  dot: string;
}

export const EVENT_KIND_STYLES: Record<EventKindApi, EventKindStyle> = {
  meeting: {
    bg: 'bg-blue-500/15',
    border: 'border-blue-500/40',
    text: 'text-blue-300',
    dot: 'bg-blue-400',
  },
  call: {
    bg: 'bg-emerald-500/15',
    border: 'border-emerald-500/40',
    text: 'text-emerald-300',
    dot: 'bg-emerald-400',
  },
  offline_meeting: {
    bg: 'bg-orange-500/15',
    border: 'border-orange-500/40',
    text: 'text-orange-300',
    dot: 'bg-orange-400',
  },
  personal_block: {
    bg: 'bg-bg-overlay',
    border: 'border-border-subtle',
    text: 'text-fg-secondary',
    dot: 'bg-fg-tertiary',
  },
  deadline: {
    bg: 'bg-red-500/15',
    border: 'border-red-500/40',
    text: 'text-red-300',
    dot: 'bg-red-400',
  },
  milestone: {
    bg: 'bg-violet-500/15',
    border: 'border-violet-500/40',
    text: 'text-violet-300',
    dot: 'bg-violet-400',
  },
  incident: {
    bg: 'bg-red-500/20',
    border: 'border-red-500/50',
    text: 'text-red-300',
    dot: 'bg-red-500',
  },
  release: {
    bg: 'bg-amber-500/15',
    border: 'border-amber-500/40',
    text: 'text-amber-300',
    dot: 'bg-amber-400',
  },
  transition: {
    bg: 'bg-sky-500/15',
    border: 'border-sky-500/40',
    text: 'text-sky-300',
    dot: 'bg-sky-400',
  },
  other: {
    bg: 'bg-bg-overlay',
    border: 'border-border-subtle',
    text: 'text-fg-secondary',
    dot: 'bg-fg-tertiary',
  },
};

export interface CalendarParticipantDomain {
  id: string;
  userId: string | null;
  personId: string | null;
  rsvp: RsvpStatusApi;
}

export interface CalendarReminderDomain {
  id: string;
  offsetMin: number;
  channel: ReminderChannelApi;
}

export interface CalendarEventDomain {
  type: 'event';
  id: string;
  kind: EventKindApi;
  kindLabel: string;
  title: string;
  startAt: Date;
  endAt: Date | null;
  durationMin: number | null;
  isOnline: boolean;
  ownerId: string | null;
  location: string | null;
  counterparty: string | null;
  description: string | null;
  visibility: EventVisibilityApi;
  status: EventStatusApi;
  projectId: string | null;
  participants: CalendarParticipantDomain[];
  reminders: CalendarReminderDomain[];
  rrule: string | null;
  timezone: string;
  allDay: boolean;
  joinUrl: string | null;
  raw: EventApi;
}

export interface CalendarIssueDomain {
  type: 'issue';
  id: string;
  title: string;
  dueDate: Date;
  projectId: string;
  projectName: string | null;
  priority: string;
  stateId: string | null;
}

export type CalendarTimelineItem = CalendarEventDomain | CalendarIssueDomain;

function mapParticipant(p: EventParticipantApi): CalendarParticipantDomain {
  return {
    id: p.id,
    userId: p.userId,
    personId: p.personId,
    rsvp: p.rsvp,
  };
}

export function toCalendarEvent(api: EventApi): CalendarEventDomain {
  return {
    type: 'event',
    id: api.id,
    kind: api.kind,
    kindLabel: EVENT_KIND_LABELS[api.kind] ?? api.kind,
    title: api.title,
    startAt: new Date(api.startAt),
    endAt: api.endAt ? new Date(api.endAt) : null,
    durationMin: api.durationMin,
    isOnline: api.online,
    ownerId: api.ownerId,
    location: api.location,
    counterparty: api.counterparty ?? null,
    description: api.description,
    visibility: api.visibility,
    status: api.status,
    projectId: api.projectId,
    participants: api.participants.map(mapParticipant),
    reminders: api.reminders.map((r) => ({
      id: r.id,
      offsetMin: r.offsetMin,
      channel: r.channel,
    })),
    rrule: api.rrule,
    timezone: api.timezone,
    allDay: api.allDay,
    joinUrl: api.joinUrl ?? null,
    raw: api,
  };
}

export function toCalendarIssue(api: IssueCalendarItemApi): CalendarIssueDomain {
  return {
    type: 'issue',
    id: api.id,
    title: api.title,
    dueDate: new Date(api.dueDate),
    projectId: api.projectId,
    projectName: api.projectName,
    priority: api.priority,
    stateId: api.stateId,
  };
}

export function toCalendarTimelineItem(
  api: CalendarItemApi,
): CalendarTimelineItem {
  if (api.type === 'event') return toCalendarEvent(api.event);
  return toCalendarIssue(api.issue);
}
