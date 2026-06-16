import { z } from 'zod';

export const ChannelBindingPreferencesSchema = z
  .object({
    quietHours: z
      .string()
      .regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/, 'формат "HH:mm-HH:mm"')
      .optional(),
    eventTypeAllow: z.array(z.string().min(1)).optional(),
    eventTypeDeny: z.array(z.string().min(1)).optional(),
    rateLimitPerHour: z.number().int().positive().optional(),
    disabledUntil: z.string().datetime().optional(),
  })
  .strict();

export type ChannelBindingPreferences = z.infer<typeof ChannelBindingPreferencesSchema>;
