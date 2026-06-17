import { z } from 'zod';

export const UpdateSecuritySettingSchema = z.object({
  value: z.unknown(),
  reason: z.string().trim().min(10).max(1000),
});
export type UpdateSecuritySettingDto = z.infer<typeof UpdateSecuritySettingSchema>;
