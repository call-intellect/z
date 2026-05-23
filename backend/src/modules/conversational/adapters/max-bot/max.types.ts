/**
 * TypeScript-описание подмножества MAX Bot API (mssgr.ru / dev.max.ru),
 * нужного SBA β-1.
 *
 * Источник: context7 verified 2026-05-22 — `dev.max.ru/docs-api`.
 * Документация MAX более лаконична, чем Telegram: основные методы —
 * `POST /messages` (sendMessage), `POST /subscriptions` (setWebhook),
 * `DELETE /subscriptions` (deleteWebhook). Авторизация — header
 * `Authorization: <access_token>`.
 *
 * NB (SBA β-1 rip-out, 2026-05-23): zero-button. Удалены
 * MaxInlineKeyboardAttachment, MaxCallback, attachments из sendMessage,
 * callback из update.
 *
 * Формат webhook-update'а: trustим `update_type='message_created'`.
 */

// ────────────────────── outbound — sendMessage ──────────────────────

/**
 * sendMessage без `attachments` — β-1 zero-button. Mediа-вложения
 * не отправляем; только plain text.
 */
export interface MaxSendMessageRequest {
  /** Кому шлём — id чата (диалог bot ↔ user, обычно равен user_id). */
  chat_id?: string | number;
  /** Альтернатива chat_id — user_id (зависит от формы интеграции MAX). */
  user_id?: string | number;
  text: string;
}

export interface MaxSendMessageResponse {
  message?: {
    mid?: string;
    timestamp?: number;
  };
}

// ────────────────────── inbound — Update ──────────────────────

export interface MaxUser {
  user_id?: number;
  name?: string;
  username?: string;
}

export interface MaxRecipient {
  chat_id?: number;
  user_id?: number;
}

/**
 * Вложение от пользователя (voice / document). Поля документированы
 * фрагментарно — defensive-парсинг по нескольким возможным полям
 * (`type`, `payload.file_id`, `payload.url`, `payload.duration`).
 */
export interface MaxIncomingAttachment {
  type?: string;
  payload?: {
    file_id?: string;
    url?: string;
    duration?: number;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
    [k: string]: unknown;
  };
}

export interface MaxMessageBody {
  mid?: string;
  text?: string;
  /** Вложения от пользователя (voice/document). */
  attachments?: MaxIncomingAttachment[];
}

export interface MaxMessage {
  recipient?: MaxRecipient;
  sender?: MaxUser;
  body?: MaxMessageBody;
  timestamp?: number;
}

/**
 * MAX webhook payload. Идентифицируется по `update_type`. На β-1
 * zero-button поддерживаем только `message_created` (text/voice/document).
 * `message_callback` удалён — кнопок больше нет.
 */
export interface MaxUpdate {
  update_type?: string;
  timestamp?: number;
  message?: MaxMessage;
}

// ────────────────────── Channel.config MAX ──────────────────────

export interface MaxBotChannelConfig {
  /** Расшифрованный access token (Authorization header). */
  accessToken: string;
  /** Secret для webhook (передаётся в URL `/.../<tenantId>/<secret>`, см. webhook controller). */
  webhookSecret: string;
  /** Информативное имя бота (для логов / админки). */
  botName?: string;
}
