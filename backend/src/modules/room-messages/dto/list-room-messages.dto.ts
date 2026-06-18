import { z } from 'zod';

export const ListRoomMessagesQuerySchema = z.object({
  since: z.string().datetime({ message: 'since должен быть ISO 8601 datetime' }).optional(),
});

export type ListRoomMessagesQuery = z.infer<typeof ListRoomMessagesQuerySchema>;
