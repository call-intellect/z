import { z } from 'zod';

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
  primaryRole: string | null;
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

export type OrgMemberSearchItemDto = OrgMemberUserItemDto | OrgMemberPersonItemDto;

export interface OrgMembersSearchResponseDto {
  items: OrgMemberSearchItemDto[];
}
