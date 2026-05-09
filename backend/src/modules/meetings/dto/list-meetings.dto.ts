import { MeetingStatus, MeetingType } from '@prisma/client';
import { z } from 'zod';

/**
 * Query-параметры для `GET /api/v1/meetings`.
 *
 * `page` — 1-индексированный (для пользователя), внутри сервиса конвертируем
 * в `skip = (page - 1) * limit`.
 */
export const ListMeetingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(MeetingStatus).optional(),
  type: z.nativeEnum(MeetingType).optional(),
});

export type ListMeetingsQuery = z.infer<typeof ListMeetingsQuerySchema>;
