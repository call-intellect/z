import { z } from 'zod';

export const ChatV2ScopeEnum = z.enum(['org', 'meeting', 'card', 'theme', 'entity']);

export type ChatV2ScopeDto = z.infer<typeof ChatV2ScopeEnum>;

export const ChatV2AskSchema = z
  .object({
    scope: ChatV2ScopeEnum,
    scopeId: z.string().min(1).optional().nullable(),
    query: z.string().trim().min(1).max(2000),
  })
  .refine(
    (val) => {
      if (val.scope === 'org') return true;
      return typeof val.scopeId === 'string' && val.scopeId.length > 0;
    },
    {
      message: 'scopeId обязателен для scope=meeting/card/theme/entity',
      path: ['scopeId'],
    },
  );

export type ChatV2AskDto = z.infer<typeof ChatV2AskSchema>;
