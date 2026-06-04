import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../../common/config/index';

/**
 * Тонкий REST-клиент к админ-API прокси `telegram.crossmark.ru`.
 *
 * Источник: Swagger прокси https://telegram.crossmark.ru/docs + гайд
 * https://telegram.crossmark.ru/guide.
 *
 * Авторизация (2026-06-04): **статический Bearer-токен** из ENV
 * `TELEGRAM_PROXY_TOKEN`. Раньше использовались email/password +
 * `POST /auth/login` с кэшированием JWT в Redis — это было хрупко
 * (ротация серверного секрета, спам логинами с разных нод). Теперь токен
 * выпускается один раз в веб-админке прокси (`POST /api/tokens`) и
 * задаётся в ENV. Клиент не ходит в `/auth/login` и не кэширует ничего.
 *
 * Контракт регистрации бота (по Swagger):
 *   - `POST /api/bots`  body `{ name, token, targetWebhookUrl }` → 201 BotResponseDto.
 *   - `PATCH /api/bots/{id}` body `{ name?, token?, targetWebhookUrl? }` → 200 BotResponseDto.
 *   - `GET /api/bots` → `{ total, items: BotResponseDto[] }`.
 *   - Прокси сам генерирует webhook-secret и пробрасывает его в заголовке
 *     `X-Telegram-Bot-Api-Secret-Token` к нашему `targetWebhookUrl`. Этот
 *     секрет НЕ отдаётся через REST (только в веб-карточке бота), поэтому
 *     мы кладём СВОЙ секрет в путь `targetWebhookUrl` (см.
 *     `AdminTelegramBotService` и `TelegramWebhooksController`).
 *
 * BotResponseDto (ключевые поля): `id`, `name`, `username`,
 * `telegramBotId`, `tokenPreview` (`<botId>:******<last4>`),
 * `webhookUrl` (URL который прокси даёт Telegram), `targetWebhookUrl`,
 * `isActive`, `webhookError`.
 */
@Injectable()
export class TelegramProxyAdminClient {
  private readonly logger = new Logger(TelegramProxyAdminClient.name);

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  /**
   * Возвращает статический Bearer-токен админ-API прокси из ENV.
   *
   * Бросает `TelegramProxyAdminError` если:
   *   - прокси выключен (`TELEGRAM_PROXY_ENABLED=false`),
   *   - не задан `TELEGRAM_PROXY_TOKEN`.
   */
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
      throw new TelegramProxyAdminError(
        'auth',
        0,
        'TELEGRAM_PROXY_TOKEN не задан',
        false,
      );
    }
    return token;
  }

  /**
   * Зарегистрировать (или обновить) бота в прокси. Идемпотентен по
   * `token`: сначала ищем бота через `getBotByToken`, если есть — `PATCH`,
   * иначе — `POST`.
   *
   * Параметры:
   *   - `name` — отображаемое имя бота в админке прокси (required для POST).
   *   - `token` — Bot API token (plain, не шифрованный).
   *   - `targetUrl` — наш публичный URL приёма webhook'а, уже включающий
   *     секрет в пути (`https://<host>/api/v1/webhooks/telegram-bot/s/<secret>`).
   *
   * Возвращает информацию о боте в прокси (id, маска токена, target_url).
   */
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
      throw new TelegramProxyAdminError(
        'upsertBot',
        0,
        'targetUrl должен быть https://...',
        false,
      );
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
      // Прокси создал/обновил запись бота, но `setWebhook` у Telegram
      // вернул ошибку (например, невалидный токен). Это не «успех».
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

  /**
   * Найти бота в прокси по token. Прокси-API не специфицирует прямой
   * lookup по token, поэтому делаем `GET /api/bots` + локальная
   * фильтрация по `telegramBotId` (число до `:` в токене). Это надёжно
   * даже если в аккаунте прокси несколько ботов.
   */
  async getBotByToken(token: string): Promise<TelegramProxyBotInfo | null> {
    if (!token) return null;
    const botId = parseTelegramBotId(token);
    const raw = await this.apiRequest<unknown>('GET', '/api/bots', undefined);
    const list = parseBotList(raw);
    if (list.length === 0) return null;
    if (botId !== null) {
      const byId = list.find((b) => b.telegramBotId === botId);
      if (byId) return byId;
      // Фолбэк: совпадение по маске токена (`<botId>:******<last4>`).
      const byMask = list.find(
        (b) =>
          typeof b.tokenMasked === 'string' &&
          b.tokenMasked.startsWith(`${botId}:`),
      );
      if (byMask) return byMask;
      // botId известен, но среди ботов прокси его нет — это НЕ повод
      // молча взять чужого бота. Возвращаем null → upsertBot создаст нового.
      return null;
    }
    // botId не распарсился (нестандартный токен) — берём первого.
    return list[0] ?? null;
  }

  /**
   * Низкоуровневый JSON-запрос к админ-API прокси с авторизацией Bearer
   * статическим токеном. На 401 — внятная ошибка (статический токен
   * либо отозван, либо неверный; re-login невозможен). Прочие non-2xx —
   * пробрасываем как `TelegramProxyAdminError`.
   */
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

  /**
   * Невторгающийся пинг прокси. Используется health-cron'ом (Фаза 5) и
   * кнопкой «Проверить прокси сейчас» в админке. Не требует токена.
   */
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

  // ─────────────────────────── internals ────────────────────────────

  /** fetch с таймаутом (0 → без таймаута). */
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

/** Результат `TelegramProxyAdminClient.ping()`. */
export interface TelegramProxyPingResult {
  ok: boolean;
  status: number;
  durationMs: number;
  error?: string;
}

/** Информация о боте в прокси (то, что прокси возвращает в API). */
export interface TelegramProxyBotInfo {
  id: string;
  /** Числовой Telegram bot id (часть токена до `:`). */
  telegramBotId?: number;
  /** Маска токена вида `<botId>:******<last4>`. */
  tokenMasked?: string;
  username?: string;
  targetUrl?: string;
  /** Непустая строка, если прокси не смог установить webhook у Telegram. */
  webhookError?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Ошибка вызова админ-API прокси с признаком transient. */
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

/** Парсит числовой Telegram bot id из токена `<botId>:<rest>`. */
function parseTelegramBotId(token: string): number | null {
  const head = token.split(':')[0];
  if (!head) return null;
  const n = Number(head);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Парсит ответ прокси на upsert/get-bot (BotResponseDto). Имена полей
 * берём по Swagger (`tokenPreview`, `targetWebhookUrl`, `telegramBotId`,
 * `webhookError`), сохраняя «либеральные» фолбэки на случай эволюции
 * контракта.
 */
function parseBotInfo(payload: unknown): TelegramProxyBotInfo | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  // Если прокси оборачивает ответ в `{ data: {...} }` или `{ bot: {...} }`.
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

/** Парсит список ботов. Прокси возвращает `{ items: [...] }` (PaginatedBotsDto). */
function parseBotList(payload: unknown): TelegramProxyBotInfo[] {
  if (Array.isArray(payload)) {
    return payload.map(parseBotInfo).filter((b): b is TelegramProxyBotInfo => b !== null);
  }
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    for (const wrapper of ['items', 'bots', 'data', 'result']) {
      const inner = obj[wrapper];
      if (Array.isArray(inner)) {
        return inner
          .map(parseBotInfo)
          .filter((b): b is TelegramProxyBotInfo => b !== null);
      }
    }
  }
  return [];
}
