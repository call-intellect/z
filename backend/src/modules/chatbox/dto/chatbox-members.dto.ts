import type { ChatboxMemberLinkMode } from '@prisma/client';
import { z } from 'zod';

export const ChatboxMemberLinkSchema = z.object({
  personId: z.string().trim().min(1).nullable(),
});
export type ChatboxMemberLinkDto = z.infer<typeof ChatboxMemberLinkSchema>;

export interface ChatboxLinkedPersonDto {
  id: string;
  name: string | null;
}

export interface ChatboxMemberDto {
  id: string;
  externalId: string;
  email: string | null;
  name: string | null;
  role: string | null;
  linkMode: ChatboxMemberLinkMode;
  linkedPerson: ChatboxLinkedPersonDto | null;
}
