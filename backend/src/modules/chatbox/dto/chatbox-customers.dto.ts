import type { ChatboxMemberLinkMode } from '@prisma/client';
import { z } from 'zod';

export const ChatboxCustomerLinkSchema = z.object({
  personId: z.string().trim().min(1).nullable(),
});
export type ChatboxCustomerLinkDto = z.infer<typeof ChatboxCustomerLinkSchema>;

export interface ChatboxLinkedPersonDto {
  id: string;
  name: string | null;
}

export interface ChatboxCustomerDto {
  id: string;
  externalId: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  linkMode: ChatboxMemberLinkMode;
  linkedPerson: ChatboxLinkedPersonDto | null;
}
