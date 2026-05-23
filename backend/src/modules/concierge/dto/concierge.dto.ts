import { z } from 'zod';

/**
 * SBA γ-2 — DTO для модуля concierge.
 * См. plans/tz/2026-05-23-sba-gamma-2-concierge-agent.md §7.
 */

/**
 * pageContext — серверу передаётся снимок страницы, на которой пользователь
 * задал вопрос. Используется ConciergeContextBuilderService для подмешивания
 * в system prompt («ты на странице карточки X, её состояние такое-то…»).
 *
 * NB: clientPath / currentEntityId / currentEntityKind — opt-in. Если
 * пользователь зашёл с `/assistant` — pageContext может быть `null`.
 */
export const PageContextSchema = z
  .object({
    /** Полный path страницы клиента (включая query). */
    clientPath: z.string().max(2048).optional(),
    /** Тип сущности, если страница привязана к ней (`meeting`/`card`/...). */
    currentEntityKind: z.string().max(64).optional(),
    /** ID сущности страницы (cuid/uuid). */
    currentEntityId: z.string().max(128).optional(),
    /** Свободная карта namespace=value для специфичных страниц. */
    extras: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type PageContextDto = z.infer<typeof PageContextSchema>;

/**
 * POST /api/v1/concierge/messages — отправить сообщение Concierge.
 * Ответ — SSE stream (см. controller'е).
 */
export const PostConciergeMessageBodySchema = z.object({
  userMessage: z.string().trim().min(1).max(4000),
  conversationId: z.string().min(1).max(128).optional(),
  pageContext: PageContextSchema.optional(),
  /**
   * Если true — клиент не поддерживает SSE и просит ответ одной HTTP-respone
   * (long polling). Сервер всё равно может отправить streaming, но клиент
   * соберёт chunks в один блок. Опц.
   */
  noStream: z.boolean().optional(),
});
export type PostConciergeMessageBodyDto = z.infer<
  typeof PostConciergeMessageBodySchema
>;

/**
 * GET /api/v1/concierge/conversations — список диалогов user'а.
 */
export const ListConciergeConversationsQuerySchema = z.object({
  archived: z.coerce.boolean().optional().default(false),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type ListConciergeConversationsQueryDto = z.infer<
  typeof ListConciergeConversationsQuerySchema
>;

/**
 * POST /api/v1/concierge/undo/:logId — откатить tool call.
 */
export const UndoConciergeBodySchema = z.object({}).strict();
export type UndoConciergeBodyDto = z.infer<typeof UndoConciergeBodySchema>;
