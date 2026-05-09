import { z } from 'zod';

export const ChatAskSchema = z.object({
  message: z.string().trim().min(1),
});

export type ChatAskDto = z.infer<typeof ChatAskSchema>;
