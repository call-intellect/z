import { z } from 'zod';

export const ChatV2ScopeEnum = z.enum([
  'org',
  'meeting',
  'card',
  'theme',
  'entity',
  'personal',
  'issue',
]);
export type ChatV2ScopeDto = z.infer<typeof ChatV2ScopeEnum>;

export const ChatV2ModeEnum = z.enum(['factual', 'synthetic', 'clone_style']);
export type ChatV2ModeDto = z.infer<typeof ChatV2ModeEnum>;

export const ChatV2ConversationStatusEnum = z.enum(['active', 'archived']);
export type ChatV2ConversationStatusDto = z.infer<typeof ChatV2ConversationStatusEnum>;

export const PostChatV2MessageBodySchema = z
  .object({
    question: z.string().trim().min(1).max(4000),
    conversationId: z.string().min(1).optional(),
    mode: ChatV2ModeEnum.optional(),
    scope: ChatV2ScopeEnum.optional().default('org'),
    scopeRefId: z.string().min(1).optional().nullable(),
    asOf: z.string().datetime().optional(),
  })
  .refine(
    (val) => {
      const scope = val.scope ?? 'org';
      if (scope === 'org' || scope === 'personal') return true;
      return typeof val.scopeRefId === 'string' && val.scopeRefId.length > 0;
    },
    {
      message: 'scopeRefId обязателен для scope=meeting/card/theme/entity/issue',
      path: ['scopeRefId'],
    },
  );
export type PostChatV2MessageBodyDto = z.infer<typeof PostChatV2MessageBodySchema>;

export const ListChatV2ConversationsQuerySchema = z.object({
  status: ChatV2ConversationStatusEnum.optional(),
  scope: ChatV2ScopeEnum.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type ListChatV2ConversationsQueryDto = z.infer<typeof ListChatV2ConversationsQuerySchema>;

export const PinChatV2ConversationBodySchema = z.object({
  pinned: z.boolean(),
});
export type PinChatV2ConversationBodyDto = z.infer<typeof PinChatV2ConversationBodySchema>;
