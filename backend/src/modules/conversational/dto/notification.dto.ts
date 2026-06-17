import { z } from 'zod';

export const ListMyNotificationsQuerySchema = z.object({
  status: z.enum(['unread', 'all', 'pending_response']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().min(1).optional(),
});
export type ListMyNotificationsQueryDto = z.infer<typeof ListMyNotificationsQuerySchema>;

export const RespondNotificationSchema = z.object({
  payload: z.record(z.string(), z.unknown()),
});
export type RespondNotificationDto = z.infer<typeof RespondNotificationSchema>;

export const CreateFreeNoteSchema = z.object({
  text: z.string().trim().min(1).max(20_000),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateFreeNoteDto = z.infer<typeof CreateFreeNoteSchema>;
