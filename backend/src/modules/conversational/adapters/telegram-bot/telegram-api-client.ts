import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../../common/config/index';
import { BusinessMetricsService } from '../../../../common/metrics/business-metrics.service';
import { RedisService } from '../../../../common/redis/redis.service';

import type {
  TelegramApiResponse,
  TelegramInlineKeyboardMarkup,
  TelegramSendMessageRequest,
  TelegramSetWebhookRequest,
  TelegramBotCommand,
  TelegramAnswerCallbackQueryRequest,
} from './telegram.types';

/**
 * Тонкий клиент Telegram Bot API.
 *
 * Документация (context7 verified 2026-05-22, source `core.telegram.org/bots/api`):
 *   - Все методы — POST `https://api.telegram.org/bot<token>/METHOD_NAME`.
 *   - Body — application/json.
 *   - Ответ — `{ok: boolean, result?, description?, error_code?}`.
 *
 * Здесь — только `sendMessage`, `setWebhook`, `setMyCommands`,
 * `answerCallbackQuery`, `deleteWebhook`, `getMe`. Этого достаточно для
 * SBA β-1 outbound + setup. Для α-1 в `IngestModule` уже есть свой
 * клиент (`TelegramAdapterService`), но он привязан к Source — мы не
 * можем его переиспользовать без рефакторинга, поэтому делаем свой
 * тонкий клиент именно под conversational-канал.
 *
 * Rate-limit: Bot API лимит ~30 msg/sec global. Перед outbound-вызовами
 * (sendMessage/answerCallbackQuery) проверяем «глобальный» счётчик в
 * Redis (per Z-process — `cfg.telegramBot.globalRps`). Это lightweight
 * throttle: при превышении просто ждём 100мс и пробуем снова — заданная
 * на β-1 «pessimistic» политика (см. sub-ТЗ §12.4).
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
   */
  async sendMessage(args: {
    token: string;
    chatId: string | number;
    text: string;
    replyMarkup?: TelegramInlineKeyboardMarkup;
    replyToMessageId?: number;
    parseMode?: 'HTML' | 'MarkdownV2';
  }): Promise<{ messageId: number; chatId: number }> {
    await this.throttle();
    const body: TelegramSendMessageRequest = {
      chat_id: args.chatId,
      text: args.text,
      ...(args.parseMode ? { parse_mode: args.parseMode } : {}),
      ...(args.replyMarkup ? { reply_markup: args.replyMarkup } : {}),
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

  /** answerCallbackQuery — без текста (просто закрыть «крутилку» в UI). */
  async answerCallbackQuery(args: {
    token: string;
    callbackQueryId: string;
    text?: string;
  }): Promise<void> {
    await this.throttle();
    const body: TelegramAnswerCallbackQueryRequest = {
      callback_query_id: args.callbackQueryId,
      ...(args.text ? { text: args.text } : {}),
    };
    await this.call<boolean>(args.token, 'answerCallbackQuery', body);
  }

  // ─────────────────────── setup API methods ────────────────────────

  async setWebhook(args: {
    token: string;
    url: string;
    secretToken: string;
    allowedUpdates?: Array<'message' | 'callback_query' | 'edited_message'>;
  }): Promise<void> {
    const body: TelegramSetWebhookRequest = {
      url: args.url,
      secret_token: args.secretToken,
      allowed_updates: args.allowedUpdates ?? ['message', 'callback_query'],
      drop_pending_updates: false,
    };
    await this.call<boolean>(args.token, 'setWebhook', body);
  }

  async deleteWebhook(args: { token: string }): Promise<void> {
    await this.call<boolean>(args.token, 'deleteWebhook', {
      drop_pending_updates: false,
    });
  }

  async setMyCommands(args: {
    token: string;
    commands: TelegramBotCommand[];
  }): Promise<void> {
    await this.call<boolean>(args.token, 'setMyCommands', {
      commands: args.commands,
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
