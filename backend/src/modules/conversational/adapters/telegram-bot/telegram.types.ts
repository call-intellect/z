/**
 * TypeScript-описание подмножества Telegram Bot API, нужного SBA β-1.
 *
 * Источник: context7 verified 2026-05-22 — `core.telegram.org/bots/api`.
 * Полная спецификация Bot API огромная; здесь только то, что использует
 * наш `TelegramApiClient` + `TelegramBotChannelAdapter`.
 */

// ────────────────────── Bot API envelope ──────────────────────

export interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

// ────────────────────── outbound — sendMessage / answer ──────────────────────

export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

export interface TelegramSendMessageRequest {
  chat_id: string | number;
  text: string;
  parse_mode?: 'HTML' | 'MarkdownV2';
  reply_markup?: TelegramInlineKeyboardMarkup;
  reply_to_message_id?: number;
  disable_web_page_preview?: boolean;
}

export interface TelegramAnswerCallbackQueryRequest {
  callback_query_id: string;
  text?: string;
  show_alert?: boolean;
}

// ────────────────────── setup — setWebhook / setMyCommands ──────────────────────

export interface TelegramSetWebhookRequest {
  url: string;
  secret_token: string;
  allowed_updates?: string[];
  drop_pending_updates?: boolean;
}

export interface TelegramBotCommand {
  command: string;
  description: string;
}

// ────────────────────── inbound — Update / Message / CallbackQuery ──────────────────────

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type?: string;
  title?: string;
  username?: string;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
  reply_to_message?: TelegramMessage;
  /** Любые медиа-аттачи — для β-1 пока игнорируются (см. §12.3 sub-ТЗ). */
  voice?: unknown;
  audio?: unknown;
  photo?: unknown;
  document?: unknown;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

// ────────────────────── Channel.config Telegram ──────────────────────

/**
 * Структура расшифрованного `Channel.config` для `kind='telegram_bot'`.
 * Сам токен и secret лежат в БД как `gcm:v1:...` — `CryptoService.encrypt`.
 */
export interface TelegramBotChannelConfig {
  /** Расшифрованный Bot Token (формат `<bot_id>:<secret>`). */
  botToken: string;
  /** Secret для X-Telegram-Bot-Api-Secret-Token. */
  webhookSecret: string;
  /** Username бота — для логов и UI. */
  botUsername?: string;
}
