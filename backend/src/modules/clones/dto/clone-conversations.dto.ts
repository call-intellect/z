import { z } from 'zod';

/**
 * ТЗ 2026-05-26 §2.7 — `GET /api/v1/clones/conversations`.
 *
 * Список диалогов текущего пользователя с конкретным клоном.
 * Используется фронтом (Волна 3) для боковой панели «Прошлые диалоги» в
 * `CloneChatClient` через хук `useCloneConversations(roleId)`.
 *
 * Маппинг к модели Prisma:
 *   - На уровне БД диалоги хранятся в `ChatV2Conversation` со `scope='card'`
 *     и `scopeRefId = personId | roleId` (см. `ClonesService.createCloneConversation`).
 *     Отдельной модели `CloneConversation` в схеме нет — пара (cloneType, cloneRefId)
 *     транслируется в (scope='card', scopeRefId=cloneRefId), а различие
 *     person/role обеспечивается валидацией существования сущности.
 *   - `lastMessageAt` — это `ChatV2Conversation.updatedAt` (обновляется при
 *     добавлении сообщения через ConversationsService).
 *   - `messageCount` — через include `_count: { messages: true }`.
 *   - Soft-delete у ChatV2Conversation отсутствует, поэтому фильтр —
 *     `status: 'active'` (archived не показываем в этой панели).
 *
 * Сortировка: `updatedAt DESC` (свежие диалоги сверху).
 * Pagination: cursor-based (id последнего возвращённого диалога).
 */

export const CloneConversationsQuerySchema = z.object({
  cloneType: z.enum(['person', 'role']),
  cloneRefId: z
    .string({ error: 'cloneRefId обязателен' })
    .cuid('Некорректный идентификатор клона'),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  /**
   * id последнего возвращённого диалога из предыдущей страницы (id —
   * UUID, не cuid, поэтому валидация мягкая — min(1)/max(64)).
   */
  cursor: z.string().min(1).max(64).optional(),
});
export type CloneConversationsQuery = z.infer<
  typeof CloneConversationsQuerySchema
>;

export interface CloneConversationListItemDto {
  /** ChatV2Conversation.id (UUID). */
  id: string;
  /**
   * ChatV2Conversation.title. NULL до первой LLM-генерации title'а — фронт
   * показывает «Новый диалог».
   */
  title: string | null;
  /**
   * ISO дата последнего активного действия с диалогом
   * (= ChatV2Conversation.updatedAt).
   */
  lastMessageAt: string;
  /** Количество сообщений в диалоге (включая user + assistant). */
  messageCount: number;
  /** ISO дата создания диалога. */
  createdAt: string;
}

export interface CloneConversationsListResponseDto {
  items: CloneConversationListItemDto[];
  /** id последнего элемента для следующей страницы или null если больше нет. */
  nextCursor: string | null;
}
