import { z } from 'zod';

export const SendRoomMessageSchema = z.object({
  clientMessageId: z
    .string()
    .trim()
    .min(8, 'clientMessageId слишком короткий')
    .max(64, 'clientMessageId слишком длинный'),
  content: z
    .string()
    .min(1, 'content не может быть пустым')
    .max(20_000, 'content слишком длинный (DTO-лимит)'),
});

export type SendRoomMessageDto = z.infer<typeof SendRoomMessageSchema>;
