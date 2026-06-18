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

@Injectable()
export class TelegramApiClient {
  private readonly logger = new Logger(TelegramApiClient.name);

  private static readonly RPS_KEY_PREFIX = 'tg:bot:rps';

  private static readonly RATE_LIMIT_MAX_WAIT_TRIES = 10;

  private static readonly RATE_LIMIT_PAUSE_MS = 100;

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

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
      ...(args.replyToMessageId ? { reply_to_message_id: args.replyToMessageId } : {}),
    };
    const res = await this.call<{ message_id: number; chat: { id: number } }>(
      args.token,
      'sendMessage',
      body,
    );
    return { messageId: res.message_id, chatId: res.chat.id };
  }

  async setWebhook(args: {
    token: string;
    url: string;
    secretToken: string;
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

  async getFile(args: { token: string; fileId: string }): Promise<TelegramGetFileResponse> {
    return this.call<TelegramGetFileResponse>(args.token, 'getFile', {
      file_id: args.fileId,
    });
  }

  async downloadFile(args: { token: string; filePath: string }): Promise<Buffer> {
    const url = `${this.resolveFileBase()}/file/bot${args.token}/${args.filePath}`;
    const startedAt = Date.now();
    let res: Response;
    try {
      res = await this.fetchWithTimeout(url, { method: 'GET' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.recordProxyOutcome({
        apiMethod: 'downloadFile',
        outcome: 'network',
        startedAt,
      });
      this.metrics.incTelegramBotApiError({
        apiMethod: 'downloadFile',
        code: 'network_error',
      });
      throw new TelegramApiError('downloadFile', 0, `network: ${message}`, true);
    }
    if (!res.ok) {
      const outcome = this.classifyProxyOutcomeByStatus(res.status, 'telegram');
      this.recordProxyOutcome({
        apiMethod: 'downloadFile',
        outcome,
        startedAt,
      });
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
    this.recordProxyOutcome({
      apiMethod: 'downloadFile',
      outcome: 'ok',
      startedAt,
    });
    return Buffer.from(arrayBuffer);
  }

  private async call<T>(token: string, method: string, body: unknown): Promise<T> {
    const url = `${this.resolveApiBase()}/bot${token}/${method}`;
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    };
    const startedAt = Date.now();
    let res: Response;
    try {
      res = await this.fetchWithTimeout(url, init);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.recordProxyOutcome({ apiMethod: method, outcome: 'network', startedAt });
      this.metrics.incTelegramBotApiError({
        apiMethod: method,
        code: 'network_error',
      });
      throw new TelegramApiError(method, 0, `network: ${message}`, true);
    }

    let json: TelegramApiResponse<T> | undefined;
    let parseError = false;
    try {
      json = (await res.json()) as TelegramApiResponse<T>;
    } catch {
      parseError = true;
    }

    if (parseError || !json) {
      const source: 'proxy' | 'telegram' =
        this.cfg.telegramProxy.enabled && !res.ok ? 'proxy' : 'telegram';
      const outcome = this.classifyProxyOutcomeByStatus(res.status, source);
      this.recordProxyOutcome({ apiMethod: method, outcome, startedAt });
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

    const looksLikeTelegram = typeof (json as { ok?: unknown }).ok === 'boolean';
    const source: 'proxy' | 'telegram' =
      this.cfg.telegramProxy.enabled && !looksLikeTelegram ? 'proxy' : 'telegram';

    if (!json.ok) {
      const code = String(json.error_code ?? res.status);
      const outcome = this.classifyProxyOutcomeByStatus(res.status, source);
      this.recordProxyOutcome({ apiMethod: method, outcome, startedAt });
      this.metrics.incTelegramBotApiError({
        apiMethod: method,
        code,
      });
      const transient = res.status === 429 || res.status >= 500;
      throw new TelegramApiError(
        method,
        json.error_code ?? res.status,
        json.description ?? 'unknown',
        transient,
      );
    }
    this.recordProxyOutcome({ apiMethod: method, outcome: 'ok', startedAt });
    return json.result as T;
  }

  private resolveApiBase(): string {
    return this.cfg.telegramProxy.enabled
      ? this.cfg.telegramProxy.apiBase
      : this.cfg.telegramBot.apiBase;
  }

  private resolveFileBase(): string {
    return this.cfg.telegramProxy.enabled
      ? this.cfg.telegramProxy.fileBase
      : this.cfg.telegramBot.apiBase;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const timeoutMs = this.cfg.telegramProxy.enabled ? this.cfg.telegramProxy.requestTimeoutMs : 0;
    if (timeoutMs <= 0) return fetch(url, init);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: ac.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private recordProxyOutcome(args: {
    apiMethod: string;
    outcome: 'ok' | 'proxy_5xx' | 'proxy_4xx' | 'telegram_5xx' | 'telegram_4xx' | 'network';
    startedAt: number;
  }): void {
    if (!this.cfg.telegramProxy.enabled) return;
    this.metrics.incTelegramProxyRequest({
      apiMethod: args.apiMethod,
      outcome: args.outcome,
    });
    this.metrics.observeTelegramProxyRequestDuration({
      apiMethod: args.apiMethod,
      durationSec: (Date.now() - args.startedAt) / 1000,
    });
  }

  private classifyProxyOutcomeByStatus(
    status: number,
    source: 'proxy' | 'telegram',
  ): 'proxy_5xx' | 'proxy_4xx' | 'telegram_5xx' | 'telegram_4xx' {
    if (source === 'proxy') {
      return status >= 500 ? 'proxy_5xx' : 'proxy_4xx';
    }
    return status >= 500 ? 'telegram_5xx' : 'telegram_4xx';
  }

  private async throttle(): Promise<void> {
    const limit = this.cfg.telegramBot.globalRps;
    if (limit <= 0) return;

    for (let i = 0; i < TelegramApiClient.RATE_LIMIT_MAX_WAIT_TRIES; i++) {
      const second = Math.floor(Date.now() / 1000);
      const key = `${TelegramApiClient.RPS_KEY_PREFIX}:${second}`;
      const count = await this.redis.client.incr(key);
      if (count === 1) {
        await this.redis.client.expire(key, 2);
      }
      if (count <= limit) return;
      await sleep(TelegramApiClient.RATE_LIMIT_PAUSE_MS);
    }
    this.logger.warn(
      `TelegramApiClient.throttle: rate-limit ${limit} RPS не освободился за ${TelegramApiClient.RATE_LIMIT_MAX_WAIT_TRIES} попыток — пропускаем дальше`,
    );
  }
}

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
