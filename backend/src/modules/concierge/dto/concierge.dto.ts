import { z } from 'zod';

import { ChatV2ScopeEnum } from '../../chat-v2/dto/chat-v2.dto';

export const PageContextSchema = z
  .object({
    clientPath: z.string().max(2048).optional(),
    currentEntityKind: z.string().max(64).optional(),
    currentEntityId: z.string().max(128).optional(),
    extras: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type PageContextDto = z.infer<typeof PageContextSchema>;

export const PostConciergeMessageBodySchema = z.object({
  userMessage: z.string().trim().min(1).max(4000),
  conversationId: z.string().min(1).max(128).optional(),
  pageContext: PageContextSchema.optional(),
  scope: ChatV2ScopeEnum.optional(),
  scopeRefId: z.string().min(1).max(128).optional().nullable(),
  noStream: z.boolean().optional(),
});
export type PostConciergeMessageBodyDto = z.infer<typeof PostConciergeMessageBodySchema>;

export const ListConciergeConversationsQuerySchema = z.object({
  archived: z.coerce.boolean().optional().default(false),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type ListConciergeConversationsQueryDto = z.infer<
  typeof ListConciergeConversationsQuerySchema
>;

export const UndoConciergeBodySchema = z.object({}).strict();
export type UndoConciergeBodyDto = z.infer<typeof UndoConciergeBodySchema>;
