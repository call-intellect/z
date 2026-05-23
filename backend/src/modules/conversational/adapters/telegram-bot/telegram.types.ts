/**
 * TypeScript-описание подмножества Telegram Bot API, нужного SBA β-1.
 *
 * Источник: context7 verified 2026-05-22 — `core.telegram.org/bots/api`.
 * Полная спецификация Bot API огромная; здесь только то, что использует
 * наш `TelegramApiClient` + `TelegramBotChannelAdapter`.
 *
 * NB (SBA β-1 rip-out, 2026-05-23): zero-button. Удалены inline keyboards,
 * callback queries и slash-command setup. Адаптер больше не отвечает на
 * callback_query (Telegram сам очистит menu через `setMyCommands([])`).
 * См. plans/tz/2026-05-23-sba-beta-1-telegram-max-zero-button-ripout.md.
 */

// ────────────────────── Bot API envelope ──────────────────────

export interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

// ────────────────────── outbound — sendMessage ──────────────────────

/**
 * sendMessage без `reply_markup`: zero-button бот не показывает кнопок,
 * вся коммуникация ведётся свободным текстом / voice / документами.
 */
export interface TelegramSendMessageRequest {
  chat_id: string | number;
  text: string;
  parse_mode?: 'HTML' | 'MarkdownV2';
  reply_to_message_id?: number;
  disable_web_page_preview?: boolean;
}

// ────────────────────── setup — setWebhook ──────────────────────

export interface TelegramSetWebhookRequest {
  url: string;
  secret_token: string;
  allowed_updates?: string[];
  drop_pending_updates?: boolean;
}

// ────────────────────── inbound — Update / Message ──────────────────────

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

/** Голосовое сообщение (поле `voice`). На β-1 zero-button нужен `file_id`. */
export interface TelegramVoice {
  file_id: string;
  file_unique_id?: string;
  duration?: number;
  mime_type?: string;
  file_size?: number;
}

/** Документ (поле `document`). Нужен `file_id` для скачивания через `getFile`. */
export interface TelegramDocument {
  file_id: string;
  file_unique_id?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
  reply_to_message?: TelegramMessage;
  voice?: TelegramVoice;
  audio?: TelegramVoice;
  document?: TelegramDocument;
  /** Фото оставляем как `unknown` — на β-1 zero-button мы их не принимаем. */
  photo?: unknown;
}

/**
 * Update — zero-button. `callback_query` удалён (бот больше не делает
 * inline-кнопок). `edited_message` оставляем — пользователь может
 * исправить voice/text сразу после отправки.
 */
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

// ────────────────────── getFile ────────────────────────────────────

/**
 * Ответ `getFile`. Возвращает `file_path` — относительный путь, по которому
 * затем качается файл: `https://api.telegram.org/file/bot<token>/<file_path>`.
 * (см. core.telegram.org/bots/api#getfile, context7 verified 2026-05-23).
 */
export interface TelegramGetFileResponse {
  file_id: string;
  file_unique_id?: string;
  file_size?: number;
  file_path?: string;
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
