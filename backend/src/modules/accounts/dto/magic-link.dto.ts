import { z } from 'zod';

export const MagicLinkRequestSchema = z.object({
  email: z.string().email('Невалидный адрес электронной почты').max(254),
});
export type MagicLinkRequestDto = z.infer<typeof MagicLinkRequestSchema>;

export const MagicLinkConsumeSchema = z.object({
  token: z.string().min(20, 'Невалидный токен').max(200),
});
export type MagicLinkConsumeDto = z.infer<typeof MagicLinkConsumeSchema>;

export const AcceptInvitationMagicLinkSchema = z.object({
  magicToken: z.string().min(20, 'Невалидный токен приглашения').max(200),
});
export type AcceptInvitationMagicLinkDto = z.infer<typeof AcceptInvitationMagicLinkSchema>;
