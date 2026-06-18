import { z } from 'zod';

export const UserMappingsSchema = z.record(
  z.string().email().max(254),
  z.string().min(1).max(64).nullable(),
);

export const StartTrelloImportSchema = z
  .object({
    jsonContent: z.record(z.string(), z.unknown()),
    selectedBoardIds: z.array(z.string().min(1).max(64)).min(1).max(100),
    userMappings: UserMappingsSchema.default({}),
  })
  .strict();
export type StartTrelloImportDto = z.infer<typeof StartTrelloImportSchema>;

export const StartBitrix24ImportSchema = z
  .object({
    webhookUrl: z.string().url().max(2_048),
    selectedGroupIds: z.array(z.string().min(1).max(64)).min(1).max(100),
    userMappings: UserMappingsSchema.default({}),
  })
  .strict();
export type StartBitrix24ImportDto = z.infer<typeof StartBitrix24ImportSchema>;

export const StartYandexTrackerImportSchema = z
  .object({
    oauthToken: z.string().min(1).max(512),
    selectedQueueIds: z.array(z.string().min(1).max(64)).min(1).max(100),
    userMappings: UserMappingsSchema.default({}),
  })
  .strict();
export type StartYandexTrackerImportDto = z.infer<typeof StartYandexTrackerImportSchema>;

export const ListImportsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().max(64).optional(),
    source: z.enum(['trello', 'bitrix24', 'yandex_tracker']).optional(),
    status: z.enum(['running', 'completed', 'failed', 'cancelled']).optional(),
  })
  .strict();
export type ListImportsQuery = z.infer<typeof ListImportsQuerySchema>;
