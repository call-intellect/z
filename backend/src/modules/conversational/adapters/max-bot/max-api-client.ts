import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../../common/config/index';
import { BusinessMetricsService } from '../../../../common/metrics/business-metrics.service';
import { RedisService } from '../../../../common/redis/redis.service';

import type {
  MaxInlineKeyboardAttachment,
  MaxSendMessageRequest,
  MaxSendMessageResponse,
} from './max.types';

/**
 * Тонкий клиент MAX Bot API.
 *
 * Документация (context7 verified 2026-05-22, source `dev.max.ru/docs-api`):
 *   - Base URL: `https://platform-api.max.ru` (override через
 *     `MAX_BOT_API_BASE`).
 *   - Авторизация: header `Authorization: <access_token>`.
 *     Передача через query больше не поддерживается.
 *   - Recommended rate: ≤30 RPS (см. «Обзор → Рекомендации»).
 *
 * Здесь — только `sendMessage`, `subscribe`/`unsubscribe` webhook, `getMe`.
 * Этого достаточно для SBA β-1.
 *
 * Каркас параллелен `TelegramApiClient`. Throttle — общий per-process
 * Redis-bucket (`cfg.maxBot.globalRps`).
 */
@Injectable()
export class MaxApiClient {
  private readonly logger = new Logger(MaxApiClient.name);

  private static readonly RPS_KEY_PREFIX = 'max:bot:rps';
  private static readonly RATE_LIMIT_MAX_WAIT_TRIES = 10;
  private static readonly RATE_LIMIT_PAUSE_MS = 100;

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  // ─────────────────────── outbound ────────────────────────────────

  async sendMessage(args: {
    accessToken: string;
    chatId?: string | number;
    userId?: string | number;
    text: string;
    attachments?: MaxInlineKeyboardAttachment[];
  }): Promise<MaxSendMessageResponse> {
    await this.throttle();
    const body: MaxSendMessageRequest = {
      ...(args.chatId !== undefined ? { chat_id: args.chatId } : {}),
      ...(args.userId !== undefined ? { user_id: args.userId } : {}),
      text: args.text,
      ...(args.attachments ? { attachments: args.attachments } : {}),
    };
    return this.call<MaxSendMessageResponse>(
      args.accessToken,
      'POST',
      '/messages',
      body,
    );
  }

  // ─────────────────────── setup ───────────────────────────────────

  async subscribeWebhook(args: {
    accessToken: string;
    url: string;
  }): Promise<void> {
    await this.call<unknown>(args.accessToken, 'POST', '/subscriptions', {
      url: args.url,
    });
  }

  async unsubscribeWebhook(args: {
    accessToken: string;
    url: string;
  }): Promise<void> {
    const path = `/subscriptions?url=${encodeURIComponent(args.url)}`;
    await this.call<unknown>(args.accessToken, 'DELETE', path, undefined);
  }

  async getMe(args: { accessToken: string }): Promise<{
    user_id?: number;
    name?: string;
    username?: string;
  }> {
    return this.call<{ user_id?: number; name?: string; username?: string }>(
      args.accessToken,
      'GET',
      '/me',
      undefined,
    );
  }

  // ─────────────────────── internals ───────────────────────────────

  private async call<T>(
    accessToken: string,
    httpMethod: 'GET' | 'POST' | 'DELETE',
    path: string,
    body: unknown,
  ): Promise<T> {
    const url = `${this.cfg.maxBot.apiBase}${path.startsWith('/') ? '' : '/'}${path}`;
    const init: RequestInit = {
      method: httpMethod,
      headers: {
        'Content-Type': 'application/json',
        Authorization: accessToken,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    };
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.metrics.incMaxBotApiError({
        apiMethod: path,
        code: 'network_error',
      });
      throw new MaxApiError(path, 0, `network: ${message}`, true);
    }

    let parsed: unknown = null;
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        parsed = await res.json();
      } catch {
        parsed = null;
      }
    } else {
      try {
        // некоторые ответы (subscribe / unsubscribe) могут быть без content-type
        const text = await res.text();
        parsed = text ? safeJsonParse(text) : null;
      } catch {
        parsed = null;
      }
    }

    if (!res.ok) {
      this.metrics.incMaxBotApiError({
        apiMethod: path,
        code: `http_${res.status}`,
      });
      const description = extractDescription(parsed) ?? `HTTP ${res.status}`;
      const transient = res.status === 429 || res.status >= 500;
      throw new MaxApiError(path, res.status, description, transient);
    }
    return (parsed ?? ({} as T)) as T;
  }

  /**
   * Лёгкий throttle (per-second-bucket). Параллельная реализация
   * `TelegramApiClient.throttle`.
   */
  private async throttle(): Promise<void> {
    const limit = this.cfg.maxBot.globalRps;
    if (limit <= 0) return;

    for (let i = 0; i < MaxApiClient.RATE_LIMIT_MAX_WAIT_TRIES; i++) {
      const second = Math.floor(Date.now() / 1000);
      const key = `${MaxApiClient.RPS_KEY_PREFIX}:${second}`;
      const count = await this.redis.client.incr(key);
      if (count === 1) {
        await this.redis.client.expire(key, 2);
      }
      if (count <= limit) return;
      await sleep(MaxApiClient.RATE_LIMIT_PAUSE_MS);
    }
    this.logger.warn(
      `MaxApiClient.throttle: rate-limit ${limit} RPS не освободился за ${MaxApiClient.RATE_LIMIT_MAX_WAIT_TRIES} попыток — пропускаем дальше`,
    );
  }
}

export class MaxApiError extends Error {
  constructor(
    readonly apiMethod: string,
    readonly code: number,
    description: string,
    readonly transient: boolean,
  ) {
    super(
      `MAX Bot API ${apiMethod} failed (code=${code}, transient=${transient}): ${description}`,
    );
    this.name = 'MaxApiError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function extractDescription(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj['message'] === 'string') return obj['message'];
  if (typeof obj['description'] === 'string') return obj['description'];
  if (typeof obj['error'] === 'string') return obj['error'];
  return null;
}
