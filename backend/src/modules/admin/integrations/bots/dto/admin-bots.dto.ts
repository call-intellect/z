/**
 * Admin-redesign Фаза 6 — DTO для `AdminBotsController`.
 *
 * Управление conversational-ботами (Telegram / MAX / Email IMAP-inbox) из
 * раздела `/admin/integrations/bots`. Все формы — на русском (правило
 * `feedback_admin_ui_russian_only.md`).
 */

import { z } from 'zod';

// ──────────────────────────── set-webhook ────────────────────────────────

export const SetWebhookSchema = z.object({
  /**
   * Полный https-URL для приёма webhook'ов от Telegram / MAX. Если не задан —
   * сервис строит URL автоматически из `PUBLIC_FRONTEND_URL` (см.
   * AdminBotsService.computeTelegramWebhookUrl / computeMaxWebhookUrl).
   */
  url: z.string().url().optional(),
});
export type SetWebhookDto = z.infer<typeof SetWebhookSchema>;

// ──────────────────────────── responses ──────────────────────────────────

/**
 * Маскированный токен — отдаём только хвост `****ABCD`. Полный токен
 * наружу не возвращаем никогда — secrecy compliance.
 */
export interface MaskedSecret {
  isSet: boolean;
  lastChars: string | null;
}

export interface BotStatusResponseDto {
  /** Идентификатор бота: 'telegram' | 'max'. */
  kind: 'telegram' | 'max';
  /** Есть ли запись `Channel WHERE tenantId IS NULL AND kind=<...>`. */
  channelExists: boolean;
  /** Токен (для tg) / accessToken (для max) — masked. */
  token: MaskedSecret;
  /** Текущий webhook URL — то, что мы записали в `Channel.config.webhookUrl`. */
  webhookUrl: string | null;
  /** Дата последнего входящего webhook-update (`Channel.lastInboundAt` если ведём). */
  lastWebhookAt: string | null;
  /** Глобальный rate-limit (RPS). Источник:
   *  - сначала `AdminSetting` `conversational.<kind>_bot_global_rps`,
   *  - затем ENV (`telegramBot.globalRps` / `maxBot.globalRps`). */
  globalRps: number;
  /** Тихие часы — заглушка под админский UI. Источник:
   *  `AdminSetting` `conversational.<kind>_quiet_hours`, формат строки
   *  `HH:mm-HH:mm` / null. */
  quietHours: string | null;
  /** Текущий статус `Channel.status`: active | disabled | broken | global_disabled. */
  status: string | null;
  /** Базовый API URL (ENV TELEGRAM_BOT_API_BASE / MAX_BOT_API_BASE). */
  apiBase: string;
}

export interface EmailInboxStatusResponseDto {
  /** Включён ли IMAP-поллер (`MAIL_INBOX_ENABLED`). */
  enabled: boolean;
  /** Host IMAP-сервера. */
  host: string | null;
  /** Port. */
  port: number | null;
  /** Имя пользователя. */
  user: string | null;
  /** TLS включён. */
  tls: boolean;
  /** Папка IMAP, из которой берём письма. */
  folder: string | null;
  /** Cron-расписание поллера. */
  pollCron: string | null;
  /** Максимум писем за один прогон. */
  maxPerRun: number | null;
  /** Доменное имя инбокса (для `inbox.kora.app` алиасов). */
  domain: string | null;
  /** Дата последнего успешного fetch (TODO — ведём через Prometheus,
   *  в БД не храним; пока null). */
  lastFetchAt: string | null;
}

export interface BotWebhookActionResponseDto {
  ok: true;
  /** Куда установили (или null, если deleteWebhook). */
  webhookUrl: string | null;
  /** Когда применилось (ISO). */
  appliedAt: string;
}

export interface EmailInboxTestResponseDto {
  ok: boolean;
  /** Подсказка для админа, что попробовать дальше. */
  message: string;
  /** Что отвечал IMAP-сервер (greeting). */
  greeting?: string;
}
