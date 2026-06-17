import { z } from 'zod';

export const CloneConversationsQuerySchema = z.object({
  cloneType: z.enum(['person', 'role']),
  cloneRefId: z.string({ error: 'cloneRefId обязателен' }).cuid('Некорректный идентификатор клона'),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  cursor: z.string().min(1).max(64).optional(),
});
export type CloneConversationsQuery = z.infer<typeof CloneConversationsQuerySchema>;

export interface CloneConversationListItemDto {
  id: string;
  title: string | null;
  lastMessageAt: string;
  messageCount: number;
  createdAt: string;
}

export interface CloneConversationsListResponseDto {
  items: CloneConversationListItemDto[];
  nextCursor: string | null;
}
