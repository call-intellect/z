import { z } from 'zod';

export const JoinMeetingSchema = z.object({
  guest_name: z.string().min(1).max(80).optional(),
  invite_token: z.string().min(1).max(200).optional(),
});

export type JoinMeetingDto = z.infer<typeof JoinMeetingSchema>;
