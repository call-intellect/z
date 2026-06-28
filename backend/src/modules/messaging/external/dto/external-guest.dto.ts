import { z } from 'zod';

import type { MessageDto } from '../../dto/message.dto';

export const AccessExternalSchema = z
  .object({
    token: z.string().min(16).max(256),
  })
  .strict();
export type AccessExternalDto = z.infer<typeof AccessExternalSchema>;

export interface AccessExternalResponse {
  conversationId: string;
}

export const GuestListMessagesQuerySchema = z
  .object({
    sinceSeq: z.string().regex(/^\d+$/u).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();
export type GuestListMessagesQuery = z.infer<typeof GuestListMessagesQuerySchema>;

export interface GuestListMessagesResponse {
  items: MessageDto[];
  nextSeq: string | null;
}

export const GuestSendMessageSchema = z
  .object({
    content: z.string().min(1).max(20_000),
    clientMessageId: z.string().min(1).max(128),
  })
  .strict();
export type GuestSendMessageDto = z.infer<typeof GuestSendMessageSchema>;

export interface GuestSendMessageResponse {
  messageId: string;
  seq: string;
}

const ContactRefinement = (c: { email?: string; phone?: string }): boolean =>
  Boolean(c.email) || Boolean(c.phone);

export const RegisterRequestCodeSchema = z
  .object({
    token: z.string().min(16).max(256),
    email: z.string().email().max(320).optional(),
    phone: z.string().min(3).max(32).optional(),
  })
  .strict()
  .refine(ContactRefinement, { message: 'Нужен email или телефон' });
export type RegisterRequestCodeDto = z.infer<typeof RegisterRequestCodeSchema>;

export const RegisterSchema = z
  .object({
    token: z.string().min(16).max(256),
    email: z.string().email().max(320).optional(),
    phone: z.string().min(3).max(32).optional(),
    code: z.string().regex(/^\d{6}$/u),
  })
  .strict()
  .refine(ContactRefinement, { message: 'Нужен email или телефон' });
export type RegisterDto = z.infer<typeof RegisterSchema>;

export interface OkResponse {
  ok: true;
}

export interface RegisterResponse {
  ok: true;
  verified: true;
}
