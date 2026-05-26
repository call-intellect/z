import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../../common/config/index';
import { RedisService } from '../../../../common/redis/redis.service';

/**
 * Тонкий REST-клиент к админ-API прокси `telegram.crossmark.ru`.
 *
 * Источник: ТЗ plans/tz/2026-05-26-telegram-via-crossmark-proxy.md §3 п.3,
 * docs прокси https://telegram.crossmark.ru/guide + Swagger `/docs`.
 *
 * Контракт:
 *   - `POST /auth/login` (email + password) → JWT `{ token, exp? }`.
 *   - JWT кэшируется в Redis (ключ `tg:proxy:admin:jwt`) с TTL =
 *     `exp - now - prefetchSec`. Не в process-memory: иначе разные
 *     ноды/воркеры будут спамить логин.
 *   - На `401` от прокси — один re-login per запрос, дальше пробрасываем.
 *
 * Фаза 3 (2026-05-26): добавлены `upsertBot()`, `getBotByToken()`,
 * `apiRequest()` с retry-on-401. Точная форма запросов/ответов прокси не
 * фиксирована в публичном гайде (открытый вопрос §14 п.1 ТЗ): на этапе
 * Фазы 3 принимаем «либеральные» имена полей `target_url|targetUrl|webhook_url`,
 * `secret_token|secretToken`, `id|_id|bot_id` — извлекаем гибко.
 * Если прокси меняет контракт — точку правки концентрируем здесь.
 */
@Injectable()
export class TelegramProxyAdminClient {
  private readonly logger = new Logger(TelegramProxyAdminClient.name);

  /** Ключ кэша JWT в Redis. */
  static readonly JWT_REDIS_KEY = 'tg:proxy:admin:jwt';

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  /**
   * Получить валидный JWT для админ-операций над прокси. Если в Redis
   * лежит свежий — возвращаем его, иначе делаем `POST /auth/login` и
   * кладём в кэш с TTL до `exp - jwtPrefetchSec`.
   *
   * Бросает `TelegramProxyAdminError` если:
   *   - прокси выключен (`TELEGRAM_PROXY_ENABLED=false`),
   *   - не заданы email/password в ENV,
   *   - login вернул 4xx/5xx или невалидный JSON.
   */
  async login(): Promise<string> {
    const cached = await this.redis.client.get(TelegramProxyAdminClient.JWT_REDIS_KEY);
    if (cached) return cached;
    return this.forceLogin();
  }

  /**
   * Принудительный re-login (минуя кэш). Используется при `401` от
   * прокси, когда `login()` вернул якобы валидный (по TTL) JWT, но
   * прокси его отверг (ротация серверного секрета на стороне прокси,
   * например).
   */
  async forceLogin(): Promise<string> {
    if (!this.cfg.telegramProxy.enabled) {
      throw new TelegramProxyAdminError(
        'login',
        0,
        'TELEGRAM_PROXY_ENABLED=false — прокси выключен',
        false,
      );
    }
    const email = this.cfg.telegramProxy.adminEmail;
    const password = this.cfg.telegramProxy.adminPassword;
    if (!email || !password) {
      throw new TelegramProxyAdminError(
        'login',
        0,
        'TELEGRAM_PROXY_ADMIN_EMAIL / TELEGRAM_PROXY_ADMIN_PASSWORD не заданы',
        false,
      );
    }

    const url = `${this.cfg.telegramProxy.apiBase}/auth/login`;
    const body = JSON.stringify({ email, password });

    let res: Response;
    const startedAt = Date.now();
    try {
      res = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new TelegramProxyAdminError('login', 0, `network: ${message}`, true);
    }
    const durationMs = Date.now() - startedAt;

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const transient = res.status >= 500;
      this.logger.warn(
        { status: res.status, durationMs, bodyPreview: text.slice(0, 200) },
        'TelegramProxyAdminClient.login: non-2xx response',
      );
      throw new TelegramProxyAdminError(
        'login',
        res.status,
        `HTTP ${res.status}: ${text.slice(0, 200)}`,
        transient,
      );
    }

    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      throw new TelegramProxyAdminError(
        'login',
        res.status,
        'non-JSON response',
        false,
      );
    }

    const token = extractJwtFromLoginResponse(payload);
    if (!token) {
      throw new TelegramProxyAdminError(
        'login',
        res.status,
        'login response не содержит JWT-токен (ожидаются поля token | access_token | accessToken | jwt)',
        false,
      );
    }

    const ttlSec = this.computeTtlFromJwt(token);
    if (ttlSec > 0) {
      await this.redis.client.set(
        TelegramProxyAdminClient.JWT_REDIS_KEY,
        token,
        'EX',
        ttlSec,
      );
    } else {
      this.logger.warn(
        { ttlSec },
        'TelegramProxyAdminClient.login: вычисленный TTL ≤ 0, JWT не кэшируется',
      );
    }
    this.logger.log(
      { durationMs, ttlSec },
      'TelegramProxyAdminClient.login: успешный логин в прокси',
    );
    return token;
  }

  /**
   * Зарегистрировать (или обновить) бота в прокси. Идемпотентен по
   * `token`: сначала ищем бота через `getBotByToken`, если есть — `PUT`,
   * иначе — `POST`.
   *
   * Параметры:
   *   - `token` — Bot API token (plain, не шифрованный).
   *   - `secretToken` — webhook-secret, который прокси проставит в
   *     `setWebhook` у Telegram и форварднёт нам в `X-Telegram-Bot-Api-Secret-Token`.
   *   - `targetUrl` — наш публичный URL приёма webhook'а
   *     (`https://<host>/api/v1/webhooks/telegram-bot`).
   *
   * Возвращает информацию о боте в прокси (id, маска токена, target_url).
   */
  async upsertBot(args: {
    token: string;
    secretToken: string;
    targetUrl: string;
  }): Promise<TelegramProxyBotInfo> {
    if (!args.token) {
      throw new TelegramProxyAdminError(
        'upsertBot',
        0,
        'token не задан',
        false,
      );
    }
    if (!args.secretToken) {
      throw new TelegramProxyAdminError(
        'upsertBot',
        0,
        'secretToken не задан',
        false,
      );
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
    const body = {
      token: args.token,
      secret_token: args.secretToken,
      target_url: args.targetUrl,
    };

    const raw = existing
      ? await this.apiRequest<unknown>('PUT', `/api/bots/${existing.id}`, body)
      : await this.apiRequest<unknown>('POST', '/api/bots', body);

    const info = parseBotInfo(raw);
    if (!info) {
      throw new TelegramProxyAdminError(
        'upsertBot',
        200,
        'ответ прокси не содержит id бота',
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
   * фильтрация по «маске токена» (последние 4 символа). Если прокси
   * вернул структуру с прямым match — берём её. Если есть несколько
   * совпадений — берём первое (это нормально на dev'е с пересозданием
   * токена).
   */
  async getBotByToken(token: string): Promise<TelegramProxyBotInfo | null> {
    if (!token) return null;
    const raw = await this.apiRequest<unknown>('GET', '/api/bots', undefined);
    const list = parseBotList(raw);
    if (list.length === 0) return null;
    const tail = token.slice(-6);
    // Совпадение «маска оканчивается на наш суффикс» работает для
    // распространённых прокси-форматов вида `1234***5678`. Если прокси
    // не отдаёт маску — берём первый бот (это первый и единственный, у
    // нас один глобальный аккаунт = один бот в норме).
    const match = list.find(
      (b) =>
        typeof b.tokenMasked === 'string' && b.tokenMasked.includes(tail),
    );
    return match ?? list[0] ?? null;
  }

  /**
   * Низкоуровневый JSON-запрос к админ-API прокси с авторизацией Bearer
   * JWT. На 401 — один re-login (`forceLogin`) и retry. Все остальные
   * non-2xx — пробрасываем как `TelegramProxyAdminError`.
   */
  async apiRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body: unknown,
  ): Promise<T> {
    let jwt = await this.login();
    const buildInit = (token: string): RequestInit => ({
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const url = `${this.cfg.telegramProxy.apiBase}${path}`;
    let res = await this.fetchWithTimeout(url, buildInit(jwt));
    if (res.status === 401) {
      // Кэшированный JWT не работает — принудительно перелогиниваемся
      // и пробуем ещё раз. На второй 401 — сдаёмся.
      this.logger.warn(
        { method, path },
        'TelegramProxyAdminClient.apiRequest: 401 — re-login и повтор',
      );
      jwt = await this.forceLogin();
      res = await this.fetchWithTimeout(url, buildInit(jwt));
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
   * кнопкой «Проверить прокси сейчас» в админке. Не требует JWT.
   */
  async ping(): Promise<TelegramProxyPingResult> {
    const url = `${this.cfg.telegramProxy.apiBase}/`;
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

  /** Извлекает `exp` из JWT и считает TTL с учётом `jwtPrefetchSec`. */
  private computeTtlFromJwt(token: string): number {
    const exp = decodeJwtExp(token);
    if (exp === null) {
      // Нет `exp` → не знаем, когда токен протухнет. Кэшируем
      // консервативно на 10 минут (защищает от частых re-login без
      // риска долго юзать протухший JWT).
      return 600;
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const ttl = exp - nowSec - this.cfg.telegramProxy.jwtPrefetchSec;
    return ttl > 0 ? ttl : 0;
  }

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
  tokenMasked?: string;
  targetUrl?: string;
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

/**
 * Достаёт JWT из тела ответа `POST /auth/login`. Прокси (по гайду) не
 * фиксирует имя поля строго, на практике встречаются `token`,
 * `access_token`, `accessToken`, `jwt`. Берём первое непустое.
 */
function extractJwtFromLoginResponse(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  for (const key of ['token', 'access_token', 'accessToken', 'jwt'] as const) {
    const v = obj[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

/**
 * Парсит ответ прокси на upsert/get-bot. Прокси не специфицирует имена
 * полей жёстко — извлекаем гибко (id|_id|bot_id, target_url|targetUrl|webhook_url,
 * token_masked|tokenMasked).
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
  return {
    id,
    tokenMasked:
      typeof obj['token_masked'] === 'string'
        ? (obj['token_masked'] as string)
        : typeof obj['tokenMasked'] === 'string'
          ? (obj['tokenMasked'] as string)
          : undefined,
    targetUrl:
      typeof obj['target_url'] === 'string'
        ? (obj['target_url'] as string)
        : typeof obj['targetUrl'] === 'string'
          ? (obj['targetUrl'] as string)
          : typeof obj['webhook_url'] === 'string'
            ? (obj['webhook_url'] as string)
            : undefined,
    createdAt:
      typeof obj['created_at'] === 'string'
        ? (obj['created_at'] as string)
        : typeof obj['createdAt'] === 'string'
          ? (obj['createdAt'] as string)
          : undefined,
    updatedAt:
      typeof obj['updated_at'] === 'string'
        ? (obj['updated_at'] as string)
        : typeof obj['updatedAt'] === 'string'
          ? (obj['updatedAt'] as string)
          : undefined,
  };
}

/** Парсит список ботов. Прокси может вернуть `[...]` или `{ items: [...] }`. */
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

/**
 * Декодирует `exp` из JWT-payload без проверки подписи (нам не нужно
 * её проверять — мы доверяем источнику, что сервер прокси выдал JWT).
 * Возвращает `null` если структура невалидна или `exp` нет.
 */
function decodeJwtExp(token: string): number | null {
  const parts = token.split('.');
  const payloadRaw = parts[1];
  if (!payloadRaw) return null;
  try {
    const padded = payloadRaw.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(padded, 'base64').toString('utf8');
    const payload = JSON.parse(json) as { exp?: number };
    if (typeof payload.exp === 'number' && Number.isFinite(payload.exp)) {
      return payload.exp;
    }
    return null;
  } catch {
    return null;
  }
}
