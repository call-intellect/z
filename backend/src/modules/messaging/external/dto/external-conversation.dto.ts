import { z } from 'zod';

export const StartExternalConversationSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    clientContact: z
      .object({
        email: z.string().email().max(320).optional(),
        phone: z.string().min(3).max(32).optional(),
      })
      .strict()
      .refine((c) => Boolean(c.email) || Boolean(c.phone), {
        message: 'Нужен email или телефон клиента',
      }),
    message: z.string().min(1).max(20_000).optional(),
  })
  .strict();
export type StartExternalConversationDto = z.infer<typeof StartExternalConversationSchema>;

export interface StartExternalConversationResponse {
  conversationId: string;
  inviteLink: string;
}
