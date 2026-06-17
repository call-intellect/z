import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../../common/config/index';

@Injectable()
export class TelegramProxyAdminClient {
  private readonly logger = new Logger(TelegramProxyAdminClient.name);

  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {}

  getAdminToken(): string {
    if (!this.cfg.telegramProxy.enabled) {
      throw new TelegramProxyAdminError(
        'auth',
        0,
        'TELEGRAM_PROXY_ENABLED=false — прокси выключен',
        false,
      );
    }
    const token = this.cfg.telegramProxy.token;
    if (!token) {
      throw new TelegramProxyAdminError('auth', 0, 'TELEGRAM_PROXY_TOKEN не задан', false);
    }
    return token;
  }

  async upsertBot(args: {
    name: string;
    token: string;
    targetUrl: string;
  }): Promise<TelegramProxyBotInfo> {
    if (!args.token) {
      throw new TelegramProxyAdminError('upsertBot', 0, 'token не задан', false);
    }
    if (!args.name) {
      throw new TelegramProxyAdminError('upsertBot', 0, 'name не задан', false);
    }
    if (!/^https:\/\//i.test(args.targetUrl)) {
      throw new TelegramProxyAdminError('upsertBot', 0, 'targetUrl должен быть https://...', false);
    }

    const existing = await this.getBotByToken(args.token);

    const raw = existing
      ? await this.apiRequest<unknown>('PATCH', `/api/bots/${existing.id}`, {
          name: args.name,
          token: args.token,
          targetWebhookUrl: args.targetUrl,
        })
      : await this.apiRequest<unknown>('POST', '/api/bots', {
          name: args.name,
          token: args.token,
          targetWebhookUrl: args.targetUrl,
        });

    const info = parseBotInfo(raw);
    if (!info) {
      throw new TelegramProxyAdminError(
        'upsertBot',
        200,
        'ответ прокси не содержит id бота',
        false,
      );
    }
    if (info.webhookError) {
      throw new TelegramProxyAdminError(
        'upsertBot',
        502,
        `прокси не смог установить webhook у Telegram: ${info.webhookError}`,
        false,
      );
    }
    this.logger.log(
      { botId: info.id, action: existing ? 'update' : 'create' },
      'TelegramProxyAdminClient.upsertBot: успешно',
    );
    return info;
  }

  async getBotByToken(token: string): Promise<TelegramProxyBotInfo | null> {
    if (!token) return null;
    const botId = parseTelegramBotId(token);
    const raw = await this.apiRequest<unknown>('GET', '/api/bots', undefined);
    const list = parseBotList(raw);
    if (list.length === 0) return null;
    if (botId !== null) {
      const byId = list.find((b) => b.telegramBotId === botId);
      if (byId) return byId;
      const byMask = list.find(
        (b) => typeof b.tokenMasked === 'string' && b.tokenMasked.startsWith(`${botId}:`),
      );
      if (byMask) return byMask;
      return null;
    }
    return list[0] ?? null;
  }

  async apiRequest<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    body: unknown,
  ): Promise<T> {
    const token = this.getAdminToken();
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    };

    const url = `${this.cfg.telegramProxy.apiBase}${path}`;
    const res = await this.fetchWithTimeout(url, init);

    if (res.status === 401) {
      const text = await res.text().catch(() => '');
      throw new TelegramProxyAdminError(
        `${method} ${path}`,
        401,
        `статический TELEGRAM_PROXY_TOKEN отвергнут прокси (401): ${text.slice(0, 200)}`,
        false,
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new TelegramProxyAdminError(
        `${method} ${path}`,
        res.status,
        `HTTP ${res.status}: ${text.slice(0, 200)}`,
        res.status >= 500,
      );
    }

    if (res.status === 204) {
      return undefined as unknown as T;
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw new TelegramProxyAdminError(
        `${method} ${path}`,
        res.status,
        'non-JSON response',
        false,
      );
    }
  }

  async ping(): Promise<TelegramProxyPingResult> {
    const url = `${this.cfg.telegramProxy.apiBase}/health`;
    const startedAt = Date.now();
    try {
      const res = await this.fetchWithTimeout(url, { method: 'GET' });
      const durationMs = Date.now() - startedAt;
      return {
        ok: res.ok,
        status: res.status,
        durationMs,
        error: res.ok ? undefined : `HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        durationMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const timeoutMs = this.cfg.telegramProxy.requestTimeoutMs;
    if (timeoutMs <= 0) {
      return fetch(url, init);
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: ac.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface TelegramProxyPingResult {
  ok: boolean;
  status: number;
  durationMs: number;
  error?: string;
}

export interface TelegramProxyBotInfo {
  id: string;
  telegramBotId?: number;
  tokenMasked?: string;
  username?: string;
  targetUrl?: string;
  webhookError?: string;
  createdAt?: string;
  updatedAt?: string;
}

export class TelegramProxyAdminError extends Error {
  constructor(
    readonly apiMethod: string,
    readonly status: number,
    description: string,
    readonly transient: boolean,
  ) {
    super(
      `TelegramProxyAdmin ${apiMethod} failed (status=${status}, transient=${transient}): ${description}`,
    );
    this.name = 'TelegramProxyAdminError';
  }
}

function parseTelegramBotId(token: string): number | null {
  const head = token.split(':')[0];
  if (!head) return null;
  const n = Number(head);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseBotInfo(payload: unknown): TelegramProxyBotInfo | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  for (const wrapper of ['data', 'bot', 'result']) {
    const inner = obj[wrapper];
    if (inner && typeof inner === 'object') {
      return parseBotInfo(inner);
    }
  }
  const idRaw = obj['id'] ?? obj['_id'] ?? obj['bot_id'] ?? obj['botId'];
  if (idRaw === undefined || idRaw === null) return null;
  const id = String(idRaw);
  if (!id) return null;

  const str = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === 'string' && v.length > 0) return v;
    }
    return undefined;
  };

  const telegramBotIdRaw = obj['telegramBotId'] ?? obj['telegram_bot_id'];
  const telegramBotId =
    typeof telegramBotIdRaw === 'number' && Number.isFinite(telegramBotIdRaw)
      ? telegramBotIdRaw
      : undefined;

  return {
    id,
    ...(telegramBotId !== undefined ? { telegramBotId } : {}),
    ...(str('tokenPreview', 'token_masked', 'tokenMasked')
      ? { tokenMasked: str('tokenPreview', 'token_masked', 'tokenMasked') }
      : {}),
    ...(str('username') ? { username: str('username') } : {}),
    ...(str('targetWebhookUrl', 'target_url', 'targetUrl', 'webhook_url')
      ? { targetUrl: str('targetWebhookUrl', 'target_url', 'targetUrl', 'webhook_url') }
      : {}),
    ...(str('webhookError', 'webhook_error')
      ? { webhookError: str('webhookError', 'webhook_error') }
      : {}),
    ...(str('createdAt', 'created_at') ? { createdAt: str('createdAt', 'created_at') } : {}),
    ...(str('updatedAt', 'updated_at') ? { updatedAt: str('updatedAt', 'updated_at') } : {}),
  };
}

function parseBotList(payload: unknown): TelegramProxyBotInfo[] {
  if (Array.isArray(payload)) {
    return payload.map(parseBotInfo).filter((b): b is TelegramProxyBotInfo => b !== null);
  }
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    for (const wrapper of ['items', 'bots', 'data', 'result']) {
      const inner = obj[wrapper];
      if (Array.isArray(inner)) {
        return inner.map(parseBotInfo).filter((b): b is TelegramProxyBotInfo => b !== null);
      }
    }
  }
  return [];
}
