import type { ChatboxMemberLinkMode } from '@prisma/client';
import { z } from 'zod';

/**
 * DTO членов рабочего пространства ChatBox + ручной маппинг на Person Коры
 * (ТЗ 2026-06-05, Фаза 9).
 *
 * Запросы — Zod-валидация через ZodValidationPipe. Ответы — интерфейсы для
 * фронта: список членов с резолвом связанной Person и режимом связки.
 */

// ─────────────────────────── запросы ────────────────────────────────────

/**
 * Тело `PUT /chatbox/members/:id/link` — ручная привязка члена к Person.
 * `personId === null` — снять связь (linkMode='none').
 */
export const ChatboxMemberLinkSchema = z.object({
  personId: z.string().trim().min(1).nullable(),
});
export type ChatboxMemberLinkDto = z.infer<typeof ChatboxMemberLinkSchema>;

// ─────────────────────────── ответы ─────────────────────────────────────

/** Краткая ссылка на связанную Person. */
export interface ChatboxLinkedPersonDto {
  id: string;
  name: string | null;
}

/** Элемент списка членов ChatBox. */
export interface ChatboxMemberDto {
  id: string;
  externalId: string;
  email: string | null;
  name: string | null;
  role: string | null;
  linkMode: ChatboxMemberLinkMode;
  linkedPerson: ChatboxLinkedPersonDto | null;
}
