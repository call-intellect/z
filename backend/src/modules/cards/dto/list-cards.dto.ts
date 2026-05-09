import { z } from 'zod';

import { CARD_KINDS } from './card-kind';

/**
 * `GET /api/v1/cards`. Сортировка по `lastMeetingAt` desc по умолчанию —
 * самый свежий клиент сверху, как в Telegram.
 */
export const ListCardsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  kind: z.enum(CARD_KINDS).optional(),
  pinned: z.coerce.boolean().optional(),
  /** false — без архивных, true — только архивные, undefined — все. */
  archived: z.coerce.boolean().optional(),
  q: z.string().trim().min(1).max(200).optional(),
  sort: z
    .enum(['lastMeetingAt', 'createdAt', 'name'])
    .default('lastMeetingAt'),
});

export type ListCardsQuery = z.infer<typeof ListCardsQuerySchema>;
