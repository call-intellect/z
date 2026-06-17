import { z } from 'zod';

export const ListSettingsQuerySchema = z.object({
  category: z.string().trim().min(1).max(64).optional(),
  section: z.string().trim().min(1).max(64).optional(),
});
export type ListSettingsQueryDto = z.infer<typeof ListSettingsQuerySchema>;

export const SetSettingSchema = z.object({
  value: z.unknown(),
  reason: z.string().trim().min(1).max(1000).optional(),
  expectedUpdatedAt: z.coerce.date().optional(),
});
export type SetSettingDto = z.infer<typeof SetSettingSchema>;

export const HistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
});
export type HistoryQueryDto = z.infer<typeof HistoryQuerySchema>;
