import { z } from 'zod';

/**
 * Query `GET /api/v1/meetings/:meetingId/room-messages?since=<ISO>`.
 *
 * `since` — ISO 8601 UTC datetime. Используется фронтом для poll-style
 * подгрузки новых сообщений (хотя realtime идёт через DataChannel).
 */
export const ListRoomMessagesQuerySchema = z.object({
  since: z
    .string()
    .datetime({ message: 'since должен быть ISO 8601 datetime' })
    .optional(),
});

export type ListRoomMessagesQuery = z.infer<typeof ListRoomMessagesQuerySchema>;
