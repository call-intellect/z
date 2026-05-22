import { z } from 'zod';

/**
 * DTO модуля Events (SBA α-3, категория A онтологии).
 *
 * `Event` — событие графа знаний (meeting | incident | release | transition |
 * milestone | other). Привязано к Entity{type=event} 1:1. Не путать с
 * доменными событиями LiveKit, AI-pipeline и т.п. — RBAC ResourceType
 * назван `event_card`, чтобы избежать путаницы.
 */

export const EventKindSchema = z.enum([
  'meeting',
  'incident',
  'release',
  'transition',
  'milestone',
  'other',
]);
export type EventKindDto = z.infer<typeof EventKindSchema>;

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
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface EventDto extends EventListItemDto {
  participantsPersonIds: string[];
  outcomeSummary: string | null;
  metadata: Record<string, unknown> | null;
}

export interface ListEventsResponse {
  items: EventListItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
