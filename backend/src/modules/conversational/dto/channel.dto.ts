import { z } from 'zod';

import { ChannelBindingPreferencesSchema } from '../types/preferences.schema';

export const LinkCodeKindSchema = z.enum(['email_smtp', 'email_imap', 'telegram_bot', 'max_bot']);
export type LinkCodeKindDto = z.infer<typeof LinkCodeKindSchema>;

export const UpdatePreferencesSchema = ChannelBindingPreferencesSchema;
export type UpdatePreferencesDto = z.infer<typeof UpdatePreferencesSchema>;

export const UpdateMaxDataClassSchema = z.object({
  maxDataClass: z.enum(['public', 'internal', 'sensitive']),
});
export type UpdateMaxDataClassDto = z.infer<typeof UpdateMaxDataClassSchema>;
