import type { ChatboxMemberLinkMode } from '@prisma/client';
import { z } from 'zod';

/**
 * DTO клиентов ChatBox (ChatboxCustomer) + ручной маппинг на Person Коры
 * (ТЗ 2026-06-11 chatbox-memory-finishing, Ф1). Клон контракта менеджеров
 * (`chatbox-members.dto.ts`); `ChatboxMemberLinkMode` переиспользуется.
 *
 * Запросы — Zod-валидация через ZodValidationPipe. Ответы — интерфейсы для
 * фронта: список клиентов с резолвом связанной Person и режимом связки.
 */

// ─────────────────────────── запросы ────────────────────────────────────

/**
 * Тело `PUT /chatbox/customers/:id/link` — ручная привязка клиента к Person.
 * `personId === null` — снять связь (linkMode='none').
 */
export const ChatboxCustomerLinkSchema = z.object({
  personId: z.string().trim().min(1).nullable(),
});
export type ChatboxCustomerLinkDto = z.infer<typeof ChatboxCustomerLinkSchema>;

// ─────────────────────────── ответы ─────────────────────────────────────

/** Краткая ссылка на связанную Person. */
export interface ChatboxLinkedPersonDto {
  id: string;
  name: string | null;
}

/** Элемент списка клиентов ChatBox. */
export interface ChatboxCustomerDto {
  id: string;
  externalId: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  linkMode: ChatboxMemberLinkMode;
  linkedPerson: ChatboxLinkedPersonDto | null;
}
