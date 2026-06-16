import { z } from 'zod';

export const TelegramBotConfigSchema = z.object({
  subtype: z.literal('telegram'),
  botToken: z.string().min(20),
  botUsername: z.string().min(1),
  webhookSecret: z.string().min(32),
  allowedChatIds: z.array(z.number()).default([]),
  includeForwarded: z.boolean().default(false),
});

export type TelegramBotConfig = z.infer<typeof TelegramBotConfigSchema>;

export function parseTelegramConfig(config: unknown): TelegramBotConfig {
  const r = TelegramBotConfigSchema.safeParse(config);
  if (!r.success) {
    const issues = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Невалидный telegram-config: ${issues}`);
  }
  return r.data;
}
