import { z } from 'zod';

/**
 * Zod-схема `Source.config` для адаптера Telegram (`Source.type='bot'`,
 * subtype='telegram').
 *
 * Секреты (`botToken`, `webhookSecret`) шифруются `CryptoService` при write
 * в `SourcesService` — здесь они допускают и plain, и `gcm:v1:...`.
 */
export const TelegramBotConfigSchema = z.object({
  subtype: z.literal('telegram'),
  /** Токен бота (получают у @BotFather). 40+ символов. */
  botToken: z.string().min(20),
  /** Логин бота (для отображения и `setWebhook` URL — справочно). */
  botUsername: z.string().min(1),
  /** X-Telegram-Bot-Api-Secret-Token. Минимум 32 символа. */
  webhookSecret: z.string().min(32),
  /**
   * Список разрешённых chatId. Пустой массив = принимать сообщения из ВСЕХ
   * чатов, в которые бот добавлен.
   */
  allowedChatIds: z.array(z.number()).default([]),
  /** Принимать ли forwarded-сообщения (по умолчанию — нет). */
  includeForwarded: z.boolean().default(false),
});

export type TelegramBotConfig = z.infer<typeof TelegramBotConfigSchema>;

/**
 * Парсер: бросает с понятным сообщением, если `Source.config` не подходит.
 */
export function parseTelegramConfig(config: unknown): TelegramBotConfig {
  const r = TelegramBotConfigSchema.safeParse(config);
  if (!r.success) {
    const issues = r.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Невалидный telegram-config: ${issues}`);
  }
  return r.data;
}
