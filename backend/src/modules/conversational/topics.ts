/**
 * Имена Redis pub/sub-топиков conversational-слоя. Один файл — чтобы
 * publishers (AdminTelegramBotService) и subscribers (TelegramWebhooksController)
 * не разъехались по строковому литералу при будущих правках.
 *
 * Источник: plans/tz/2026-05-26-telegram-via-crossmark-proxy.md §2 «кэш
 * Channel.config в TelegramWebhooksController.findGlobalChannel получает
 * invalidation по событию channel.updated».
 */

/**
 * Публикуется AdminTelegramBotService при ЛЮБОЙ мутации
 * `Channel.config` глобального Telegram-канала (изменение токена,
 * webhookSecret, статуса, шаблонов). Подписчики (webhook controller)
 * сбрасывают свой in-process кэш.
 *
 * Payload — JSON `{ channelId: string, reason: string }`.
 */
export const TELEGRAM_GLOBAL_CHANNEL_UPDATED_TOPIC =
  'conversational:channel:updated:telegram_bot';
