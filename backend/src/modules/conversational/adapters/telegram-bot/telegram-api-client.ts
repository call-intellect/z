import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../../common/config/index';
import { BusinessMetricsService } from '../../../../common/metrics/business-metrics.service';
import { RedisService } from '../../../../common/redis/redis.service';

import type {
  TelegramApiResponse,
  TelegramGetFileResponse,
  TelegramSendMessageRequest,
  TelegramSetWebhookRequest,
} from './telegram.types';

/**
 * Тонкий клиент Telegram Bot API.
 *
 * Документация (context7 verified 2026-05-22, source `core.telegram.org/bots/api`):
 *   - Все методы — POST `https://api.telegram.org/bot<token>/METHOD_NAME`.
 *   - Body — application/json.
 *   - Ответ — `{ok: boolean, result?, description?, error_code?}`.
 *
 * NB (SBA β-1 rip-out, 2026-05-23): zero-button. Удалён `answerCallbackQuery`
 * (callback_query больше не приходит). `setMyCommands` оставлен —
 * `setup-telegram-bot.ts` вызывает его с пустым списком, чтобы Telegram
 * очистил menu хамбургер. Добавлены `getFile` + `downloadFile` для voice
 * + document inbound.
 */
@Injectable()
export class TelegramApiClient {
  private readonly logger = new Logger(TelegramApiClient.name);

  /** Префикс ключа Redis-счётчика для rate-limit (per-second bucket). */
  private static readonly RPS_KEY_PREFIX = 'tg:bot:rps';

  /** Сколько раз пробуем подождать-и-повторить перед тем как сдаться. */
  private static readonly RATE_LIMIT_MAX_WAIT_TRIES = 10;

  /** Пауза при достижении rate-limit (ms). */
  private static readonly RATE_LIMIT_PAUSE_MS = 100;

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  // ─────────────────────── outbound API methods ─────────────────────

  /**
   * Отправить текстовое сообщение. На успех — возвращает `message_id`
   * (number, как string для единообразия с `externalMessageId`).
   * На ошибку — бросает `TelegramApiError` (caller-у `send` worker'а
   * нужно понять, что это finalable error vs transient).
   *
   * Без `reply_markup` — β-1 zero-button.
   */
  async sendMessage(args: {
    token: string;
    chatId: string | number;
    text: string;
    replyToMessageId?: number;
    parseMode?: 'HTML' | 'MarkdownV2';
  }): Promise<{ messageId: number; chatId: number }> {
    await this.throttle();
    const body: TelegramSendMessageRequest = {
      chat_id: args.chatId,
      text: args.text,
      ...(args.parseMode ? { parse_mode: args.parseMode } : {}),
      ...(args.replyToMessageId
        ? { reply_to_message_id: args.replyToMessageId }
        : {}),
    };
    const res = await this.call<{ message_id: number; chat: { id: number } }>(
      args.token,
      'sendMessage',
      body,
    );
    return { messageId: res.message_id, chatId: res.chat.id };
  }

  // ─────────────────────── setup API methods ────────────────────────

  async setWebhook(args: {
    token: string;
    url: string;
    secretToken: string;
    /** β-1 zero-button: callback_query больше не запрашиваем. */
    allowedUpdates?: Array<'message' | 'edited_message'>;
  }): Promise<void> {
    const body: TelegramSetWebhookRequest = {
      url: args.url,
      secret_token: args.secretToken,
      allowed_updates: args.allowedUpdates ?? ['message', 'edited_message'],
      drop_pending_updates: false,
    };
    await this.call<boolean>(args.token, 'setWebhook', body);
  }

  async deleteWebhook(args: { token: string }): Promise<void> {
    await this.call<boolean>(args.token, 'deleteWebhook', {
      drop_pending_updates: false,
    });
  }

  /**
   * setMyCommands — β-1 zero-button: вызываем с пустым массивом, чтобы
   * Telegram убрал menu-хамбургер бота. Если передать commands, Telegram
   * нарисует их в меню (нам не нужно).
   */
  async setMyCommands(args: {
    token: string;
    commands?: Array<{ command: string; description: string }>;
  }): Promise<void> {
    await this.call<boolean>(args.token, 'setMyCommands', {
      commands: args.commands ?? [],
    });
  }

  async getMe(args: {
    token: string;
  }): Promise<{ id: number; username?: string; first_name?: string }> {
    return this.call<{ id: number; username?: string; first_name?: string }>(
      args.token,
      'getMe',
      undefined,
    );
  }

  // ─────────────────────── files (β-1 zero-button: voice/document) ───

  /**
   * Получить метаданные файла по `file_id` (Bot API `getFile`).
   * Возвращает `file_path` — относительный путь, по которому потом качаем
   * binary content через `downloadFile`. Контекст:
   * core.telegram.org/bots/api#getfile, context7 verified 2026-05-23.
   */
  async getFile(args: {
    token: string;
    fileId: string;
  }): Promise<TelegramGetFileResponse> {
    return this.call<TelegramGetFileResponse>(args.token, 'getFile', {
      file_id: args.fileId,
    });
  }

  /**
   * Скачать бинарный контент файла по `file_path` (из ответа `getFile`).
   * URL: `https://api.telegram.org/file/bot<token>/<file_path>`.
   * Лимит размера файла Telegram Bot API — 20 MB (см. context7).
   */
  async downloadFile(args: {
    token: string;
    filePath: string;
  }): Promise<Buffer> {
    const base = this.cfg.telegramBot.apiBase;
    const url = `${base}/file/bot${args.token}/${args.filePath}`;
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.metrics.incTelegramBotApiError({
        apiMethod: 'downloadFile',
        code: 'network_error',
      });
      throw new TelegramApiError(
        'downloadFile',
        0,
        `network: ${message}`,
        true,
      );
    }
    if (!res.ok) {
      this.metrics.incTelegramBotApiError({
        apiMethod: 'downloadFile',
        code: `http_${res.status}`,
      });
      throw new TelegramApiError(
        'downloadFile',
        res.status,
        `HTTP ${res.status}`,
        res.status >= 500,
      );
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  // ─────────────────────── internals ────────────────────────────────

  /**
   * Низкоуровневый вызов Bot API. Бросает `TelegramApiError` на сетевую/HTTP-
   * ошибку или `ok=false`. Caller'у решать — retry или final fail.
   */
  private async call<T>(
    token: string,
    method: string,
    body: unknown,
  ): Promise<T> {
    const url = `${this.cfg.telegramBot.apiBase}/bot${token}/${method}`;
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    };
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.metrics.incTelegramBotApiError({
        apiMethod: method,
        code: 'network_error',
      });
      throw new TelegramApiError(method, 0, `network: ${message}`, true);
    }

    let json: TelegramApiResponse<T>;
    try {
      json = (await res.json()) as TelegramApiResponse<T>;
    } catch {
      this.metrics.incTelegramBotApiError({
        apiMethod: method,
        code: `http_${res.status}`,
      });
      throw new TelegramApiError(
        method,
        res.status,
        `non-JSON response (HTTP ${res.status})`,
        res.status >= 500,
      );
    }

    if (!json.ok) {
      const code = String(json.error_code ?? res.status);
      this.metrics.incTelegramBotApiError({
        apiMethod: method,
        code,
      });
      // 429 / 5xx — transient (retry). 400/401/403/404 — final.
      const transient = res.status === 429 || res.status >= 500;
      throw new TelegramApiError(
        method,
        json.error_code ?? res.status,
        json.description ?? 'unknown',
        transient,
      );
    }
    return json.result as T;
  }

  /**
   * Лёгкий per-process throttle: per-second-bucket в Redis. Если RPS
   * исчерпан — спим 100мс и проверяем снова, до
   * `RATE_LIMIT_MAX_WAIT_TRIES` раз. После — пропускаем (лучше получить
   * 429 от Telegram и retry'нуть через worker, чем заблокировать поток
   * надолго).
   *
   * Алгоритм: ключ `tg:bot:rps:<utcSecond>` инкрементируется, TTL 2с.
   * Лимит сверяем с `cfg.telegramBot.globalRps`.
   */
  private async throttle(): Promise<void> {
    const limit = this.cfg.telegramBot.globalRps;
    if (limit <= 0) return;

    for (let i = 0; i < TelegramApiClient.RATE_LIMIT_MAX_WAIT_TRIES; i++) {
      const second = Math.floor(Date.now() / 1000);
      const key = `${TelegramApiClient.RPS_KEY_PREFIX}:${second}`;
      const count = await this.redis.client.incr(key);
      if (count === 1) {
        // первый инкремент — выставим TTL
        await this.redis.client.expire(key, 2);
      }
      if (count <= limit) return;
      // лимит превышен — подождём
      await sleep(TelegramApiClient.RATE_LIMIT_PAUSE_MS);
    }
    // Не дождались — отпускаем; Telegram сам ответит 429 если что.
    this.logger.warn(
      `TelegramApiClient.throttle: rate-limit ${limit} RPS не освободился за ${TelegramApiClient.RATE_LIMIT_MAX_WAIT_TRIES} попыток — пропускаем дальше`,
    );
  }
}

/** Ошибка вызова Telegram Bot API с признаком transient. */
export class TelegramApiError extends Error {
  constructor(
    readonly apiMethod: string,
    readonly code: number,
    description: string,
    readonly transient: boolean,
  ) {
    super(
      `Telegram Bot API ${apiMethod} failed (code=${code}, transient=${transient}): ${description}`,
    );
    this.name = 'TelegramApiError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
