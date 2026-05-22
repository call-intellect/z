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
 * Формат webhook-update'а сверяется по `update_type` полю:
 *   - `message_created`   — новое сообщение пользователю боту;
 *   - `message_callback`  — нажатие callback-кнопки.
 * На β-1 трактуем минимально-необходимое; неизвестные типы игнорируем.
 */

// ────────────────────── outbound — sendMessage ──────────────────────

export interface MaxInlineKeyboardCallbackButton {
  type: 'callback';
  text: string;
  payload: string;
}

export interface MaxInlineKeyboardAttachmentPayload {
  buttons: MaxInlineKeyboardCallbackButton[][];
}

export interface MaxInlineKeyboardAttachment {
  type: 'inline_keyboard';
  payload: MaxInlineKeyboardAttachmentPayload;
}

export interface MaxSendMessageRequest {
  /** Кому шлём — id чата (диалог bot ↔ user, обычно равен user_id). */
  chat_id?: string | number;
  /** Альтернатива chat_id — user_id (зависит от формы интеграции MAX). */
  user_id?: string | number;
  text: string;
  attachments?: MaxInlineKeyboardAttachment[];
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

export interface MaxMessageBody {
  mid?: string;
  text?: string;
  attachments?: unknown;
}

export interface MaxMessage {
  recipient?: MaxRecipient;
  sender?: MaxUser;
  body?: MaxMessageBody;
  timestamp?: number;
}

export interface MaxCallback {
  callback_id?: string;
  payload?: string;
  user?: MaxUser;
  message?: MaxMessage;
  timestamp?: number;
}

/**
 * MAX webhook payload. Идентифицируется по `update_type`. На β-1
 * поддерживаем `message_created` (text) и `message_callback` (callback).
 *
 * Структура: см. dev.max.ru/docs-api — типы обновлений детально
 * документированы для каждого update_type. Здесь только то, что нужно
 * парсеру inbound.
 */
export interface MaxUpdate {
  update_type?: string;
  timestamp?: number;
  message?: MaxMessage;
  callback?: MaxCallback;
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
