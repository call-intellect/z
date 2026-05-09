import { ApiKeyScope } from '@prisma/client';
import { z } from 'zod';

export const CreateApiKeySchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.nativeEnum(ApiKeyScope)).min(1).max(2),
});

export type CreateApiKeyDto = z.infer<typeof CreateApiKeySchema>;
