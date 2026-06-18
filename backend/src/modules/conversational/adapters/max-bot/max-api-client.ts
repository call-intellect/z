import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../../common/config/index';
import { BusinessMetricsService } from '../../../../common/metrics/business-metrics.service';
import { RedisService } from '../../../../common/redis/redis.service';

import type { MaxSendMessageRequest, MaxSendMessageResponse } from './max.types';

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

  async sendMessage(args: {
    accessToken: string;
    chatId?: string | number;
    userId?: string | number;
    text: string;
  }): Promise<MaxSendMessageResponse> {
    await this.throttle();
    const body: MaxSendMessageRequest = {
      ...(args.chatId !== undefined ? { chat_id: args.chatId } : {}),
      ...(args.userId !== undefined ? { user_id: args.userId } : {}),
      text: args.text,
    };
    return this.call<MaxSendMessageResponse>(args.accessToken, 'POST', '/messages', body);
  }

  async downloadAttachment(args: { accessToken: string; url: string }): Promise<Buffer> {
    let res: Response;
    try {
      res = await fetch(args.url, {
        headers: { Authorization: args.accessToken },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.metrics.incMaxBotApiError({
        apiMethod: 'downloadAttachment',
        code: 'network_error',
      });
      throw new MaxApiError('downloadAttachment', 0, `network: ${message}`, true);
    }
    if (!res.ok) {
      this.metrics.incMaxBotApiError({
        apiMethod: 'downloadAttachment',
        code: `http_${res.status}`,
      });
      throw new MaxApiError(
        'downloadAttachment',
        res.status,
        `HTTP ${res.status}`,
        res.status >= 500,
      );
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async subscribeWebhook(args: { accessToken: string; url: string }): Promise<void> {
    await this.call<unknown>(args.accessToken, 'POST', '/subscriptions', {
      url: args.url,
    });
  }

  async unsubscribeWebhook(args: { accessToken: string; url: string }): Promise<void> {
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

    let parsed: unknown;
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        parsed = await res.json();
      } catch {
        parsed = null;
      }
    } else {
      try {
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
    super(`MAX Bot API ${apiMethod} failed (code=${code}, transient=${transient}): ${description}`);
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
