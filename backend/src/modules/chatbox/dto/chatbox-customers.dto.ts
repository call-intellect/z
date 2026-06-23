import type { ChatboxMemberLinkMode } from '@prisma/client';
import { z } from 'zod';

export const ChatboxCustomerLinkSchema = z.object({
  customerId: z.string().trim().min(1).nullable(),
});
export type ChatboxCustomerLinkDto = z.infer<typeof ChatboxCustomerLinkSchema>;

export interface ChatboxLinkedCustomerDto {
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
  linkedCustomer: ChatboxLinkedCustomerDto | null;
}
