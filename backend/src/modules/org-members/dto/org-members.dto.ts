import { z } from 'zod';

/**
 * DTO модуля org-members (Calendar MVP Фаза P4, 2026-05-25).
 *
 * Объединённый поиск по «членам Org» для ParticipantPicker в EventForm:
 *   - `User` через `Membership` (коллеги, которые имеют логин в Z);
 *   - `Person` (контакты Org, в том числе ещё не активировавшие приглашение,
 *     и внешние контакты — клиенты, партнёры).
 *
 * Используется в EventForm.ParticipantPicker — нам не важна семантическая
 * чистота между «коллегой» и «контактом», важно «человек, которого можно
 * добавить в событие».
 */

export const OrgMembersSearchQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(1, 'Поисковая строка обязательна')
    .max(200, 'Поисковая строка не длиннее 200 символов'),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});
export type OrgMembersSearchQuery = z.infer<typeof OrgMembersSearchQuerySchema>;

export interface OrgMemberUserItemDto {
  type: 'user';
  userId: string;
  name: string;
  email: string;
  /** Опц. primary role (через активный Membership → не реализовано в MVP, пока null). */
  primaryRole: string | null;
  /** Опц. avatarUrl (MVP — null, фронт берёт инициалы). */
  avatarUrl: string | null;
}

export interface OrgMemberPersonItemDto {
  type: 'person';
  personId: string;
  name: string;
  email: string | null;
  relationship: 'employee' | 'external' | string;
  primaryDepartment: string | null;
}

export type OrgMemberSearchItemDto =
  | OrgMemberUserItemDto
  | OrgMemberPersonItemDto;

export interface OrgMembersSearchResponseDto {
  items: OrgMemberSearchItemDto[];
}
