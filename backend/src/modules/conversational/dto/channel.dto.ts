import { z } from 'zod';

import { ChannelBindingPreferencesSchema } from '../types/preferences.schema';

/**
 * `POST /me/channels/:kind/link-code` — сгенерировать одноразовый код для
 * привязки канала к пользователю. Для α-1 имеет смысл только для β-1
 * каналов (telegram_bot/max_bot), но эндпоинт активен заранее.
 */
export const LinkCodeKindSchema = z.enum([
  'email_smtp',
  'email_imap',
  'telegram_bot',
  'max_bot',
]);
export type LinkCodeKindDto = z.infer<typeof LinkCodeKindSchema>;

/**
 * `PATCH /me/channels/bindings/:bindingId/preferences` — обновить per-binding
 * настройки (тихие часы, фильтры, rate-limit).
 */
export const UpdatePreferencesSchema = ChannelBindingPreferencesSchema;
export type UpdatePreferencesDto = z.infer<typeof UpdatePreferencesSchema>;

/**
 * W4.3 (KC-Temporal) — `PATCH /me/channels/bindings/:bindingId/max-data-class`.
 * Пользователь устанавливает потолок чувствительности своей привязки.
 * `private` через UI недоступен (см. §W4.3 «`private` — никогда (выбор недоступен)»).
 */
export const UpdateMaxDataClassSchema = z.object({
  maxDataClass: z.enum(['public', 'internal', 'sensitive']),
});
export type UpdateMaxDataClassDto = z.infer<typeof UpdateMaxDataClassSchema>;
