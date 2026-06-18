import { z } from 'zod';

/**
 * DTO модуля Events.
 *
 * `Event` — событие графа знаний (meeting | incident | release | transition |
 * milestone | call | offline_meeting | personal_block | deadline | other).
 * Привязано к Entity{type=event} 1:1. Не путать с доменными событиями LiveKit,
 * AI-pipeline и т.п. — RBAC ResourceType назван `event_card`, чтобы избежать
 * путаницы.
 *
 * Calendar MVP (2026-05-25) расширил DTO до полного CRUD + RSVP + календарного
 * представления `/me/calendar` / `/users/:id/calendar` + find-free-slot.
 */

export const EventKindSchema = z.enum([
  'meeting',
  'incident',
  'release',
  'transition',
  'milestone',
  'call',
  'offline_meeting',
  'personal_block',
  'deadline',
  'other',
]);
export type EventKindDto = z.infer<typeof EventKindSchema>;

export const EventVisibilitySchema = z.enum(['company', 'team', 'personal']);
export type EventVisibilityDto = z.infer<typeof EventVisibilitySchema>;

export const EventStatusSchema = z.enum(['tentative', 'confirmed', 'cancelled']);
export type EventStatusDto = z.infer<typeof EventStatusSchema>;

export const EventParticipantRoleSchema = z.enum([
  'organizer',
  'required',
  'optional',
]);
export type EventParticipantRoleDto = z.infer<typeof EventParticipantRoleSchema>;

export const RsvpStatusSchema = z.enum([
  'pending',
  'accepted',
  'declined',
  'tentative',
]);
export type RsvpStatusDto = z.infer<typeof RsvpStatusSchema>;

export const ReminderChannelSchema = z.enum(['push', 'email', 'telegram']);
export type ReminderChannelDto = z.infer<typeof ReminderChannelSchema>;

// ─────────────────────────── Query / Filters ─────────────────────────

export const ListEventsQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  kind: EventKindSchema.optional(),
  /** Нижняя граница диапазона startAt (включительно). ISO-8601. */
  from: z.coerce.date().optional(),
  /** Верхняя граница диапазона startAt (включительно). ISO-8601. */
  to: z.coerce.date().optional(),
  includeDeleted: z.coerce.boolean().optional().default(false),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListEventsQuery = z.infer<typeof ListEventsQuerySchema>;

// ─────────────────────────── RRULE preset validator ──────────────────

/**
 * MVP: разрешены только пресеты FREQ=DAILY|WEEKLY|MONTHLY|YEARLY
 * с опц. `;BYDAY=MO,TU,WE,TH,FR,SA,SU`. Полный RFC-5545 парсер — Фаза 3.
 */
const RRULE_PRESET_RE =
  /^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;BYDAY=(MO|TU|WE|TH|FR|SA|SU)(,(MO|TU|WE|TH|FR|SA|SU))*)?$/;

const RruleStringSchema = z
  .string()
  .trim()
  .max(200)
  .refine((s) => RRULE_PRESET_RE.test(s), {
    message:
      'RRULE: в MVP поддерживаются только пресеты FREQ=DAILY|WEEKLY|MONTHLY|YEARLY с опц. BYDAY',
  });

// ─────────────────────────── Create / Update / RSVP ──────────────────

export const EventParticipantInputSchema = z
  .object({
    userId: z.string().min(1).max(80).optional(),
    personId: z.string().min(1).max(80).optional(),
    role: EventParticipantRoleSchema.optional().default('required'),
    /** Совместимо со старым API: optional участник = role='optional'. */
    optional: z.boolean().optional(),
  })
  .refine((p) => Boolean(p.userId) || Boolean(p.personId), {
    message: 'Участник должен иметь userId или personId',
  });
export type EventParticipantInput = z.infer<typeof EventParticipantInputSchema>;

export const EventReminderInputSchema = z.object({
  /** За сколько минут до начала. 0 — в момент начала; макс 7 дней. */
  offsetMin: z.coerce.number().int().min(0).max(60 * 24 * 7),
  channel: ReminderChannelSchema,
  /** null/undefined → всем участникам. */
  userId: z.string().min(1).max(80).nullable().optional(),
});
export type EventReminderInput = z.infer<typeof EventReminderInputSchema>;

export const CreateEventSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    /** ISO-8601 начало. */
    startAt: z.coerce.date(),
    /** ISO-8601 конец. Опц. для personal_block/deadline. */
    endAt: z.coerce.date().optional(),
    kind: EventKindSchema.default('meeting'),
    visibility: EventVisibilitySchema.optional().default('company'),
    description: z.string().max(8000).optional(),
    location: z.string().trim().max(300).optional(),
    allDay: z.boolean().optional().default(false),
    // Ф3 — статический дефолт 'Europe/Moscow' убран: теперь дефолт = TZ
    // организатора (Person→Org→Moscow), проставляется в EventsService.create.
    timezone: z.string().trim().min(1).max(64).optional(),
    rrule: RruleStringSchema.optional(),
    projectId: z.string().min(1).max(80).optional(),
    participants: z.array(EventParticipantInputSchema).max(200).optional(),
    reminders: z.array(EventReminderInputSchema).max(20).optional(),
    /** Ф6 — формат: true → онлайн (создаётся LiveKit-комната). Default false. */
    online: z.boolean().optional().default(false),
    /** Ф5 — контрагент/клиент встречи (с кем/какая компания). НЕ место. */
    counterparty: z.string().trim().max(300).optional(),
  })
  .refine(
    (v) =>
      v.kind === 'personal_block' ||
      v.kind === 'deadline' ||
      v.endAt !== undefined,
    { path: ['endAt'], message: '`endAt` обязателен для этого типа события' },
  )
  .refine((v) => !v.endAt || v.endAt >= v.startAt, {
    path: ['endAt'],
    message: '`endAt` должен быть не раньше `startAt`',
  });
export type CreateEventDto = z.infer<typeof CreateEventSchema>;

export const UpdateEventSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    startAt: z.coerce.date().optional(),
    endAt: z.coerce.date().nullable().optional(),
    kind: EventKindSchema.optional(),
    visibility: EventVisibilitySchema.optional(),
    description: z.string().max(8000).nullable().optional(),
    location: z.string().trim().max(300).nullable().optional(),
    allDay: z.boolean().optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    rrule: RruleStringSchema.nullable().optional(),
    status: EventStatusSchema.optional(),
    projectId: z.string().min(1).max(80).nullable().optional(),
    online: z.boolean().optional(),
    counterparty: z.string().trim().max(300).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Передайте хотя бы одно поле для обновления',
  });
export type UpdateEventDto = z.infer<typeof UpdateEventSchema>;

export const RsvpSchema = z.object({
  status: z.enum(['accepted', 'declined', 'tentative']),
});
export type RsvpDto = z.infer<typeof RsvpSchema>;

// ─────────────────────────── find-free-slot ──────────────────────────

export const FindFreeSlotSchema = z.object({
  participantUserIds: z.array(z.string().min(1).max(80)).min(1).max(20),
  durationMin: z.coerce.number().int().min(5).max(60 * 12),
  withinDays: z.coerce.number().int().min(1).max(30).optional().default(7),
  workingHoursOnly: z.coerce.boolean().optional().default(true),
});
export type FindFreeSlotDto = z.infer<typeof FindFreeSlotSchema>;

export interface FindFreeSlotResponse {
  slotStartAt: string | null;
  slotEndAt: string | null;
  found: boolean;
}

// ─────────────────────────── Calendar query ──────────────────────────

export const MyCalendarQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /**
   * Calendar MVP Polish (P3, 2026-05-25). Фильтр событий и задач по проекту.
   * Если задан — серверная фильтрация заменяет клиентскую, которая раньше
   * подгружала все события user'а и резала их на стороне браузера.
   */
  projectId: z.string().min(1).max(80).optional(),
});
export type MyCalendarQuery = z.infer<typeof MyCalendarQuerySchema>;

// ─────────────────────────── Response DTO ────────────────────────────

export interface EventListItemDto {
  id: string;
  entityId: string;
  kind: EventKindDto;
  title: string;
  startAt: string;
  endAt: string | null;
  durationMin: number | null;
  location: string | null;
  relatedMeetingId: string | null;
  /**
   * Calendar MVP Polish (P1, 2026-05-25). Публичный URL для подключения к
   * LiveKit-комнате связанной встречи. Заполнен только когда `kind=meeting`
   * и Meeting создан успешно. Берётся из `Event.metadata.joinUrl`.
   */
  joinUrl: string | null;
  /** Ф6 — формат встречи: true → онлайн (есть/будет видеокомната). */
  online: boolean;
  /** Ф5 — контрагент/клиент («о ком/о чём» встреча). НЕ место (location). */
  counterparty: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface EventParticipantDto {
  id: string;
  userId: string | null;
  personId: string | null;
  role: EventParticipantRoleDto;
  rsvp: RsvpStatusDto;
  rsvpAt: string | null;
}

export interface EventReminderDto {
  id: string;
  offsetMin: number;
  channel: ReminderChannelDto;
  userId: string | null;
  sentAt: string | null;
}

export interface EventDto extends EventListItemDto {
  participantsPersonIds: string[];
  outcomeSummary: string | null;
  metadata: Record<string, unknown> | null;
  // Calendar MVP fields
  ownerId: string | null;
  description: string | null;
  allDay: boolean;
  timezone: string;
  rrule: string | null;
  status: EventStatusDto;
  visibility: EventVisibilityDto;
  externalProvider: string | null;
  externalEventId: string | null;
  projectId: string | null;
  participants: EventParticipantDto[];
  reminders: EventReminderDto[];
}

export interface ListEventsResponse {
  items: EventListItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ── Calendar items (микс Event + Issue) ──────────────────────────────

export interface CalendarEventItem {
  type: 'event';
  event: EventDto;
}

export interface CalendarIssueItem {
  type: 'issue';
  issue: {
    id: string;
    title: string;
    dueDate: string;
    projectId: string;
    projectName: string | null;
    priority: string;
    stateId: string | null;
  };
}

export type CalendarItemDto = CalendarEventItem | CalendarIssueItem;

export interface CalendarResponseDto {
  items: CalendarItemDto[];
}
