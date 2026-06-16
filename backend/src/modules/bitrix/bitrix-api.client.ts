import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../common/config/index';

/**
 * Типизированный клиент Bitrix24 OAuth + REST.
 * ТЗ: plans/tz/2026-06-09-bitrix24-integration-install.md (Фаза 1).
 *
 * Два контура:
 *   - Сервер авторизации (`oauthBaseUrl`, по умолчанию https://oauth.bitrix.info):
 *     обмен `code → токены` и `refresh_token → токены`. GET с query-параметрами,
 *     включая `client_id`/`client_secret` (секрет уходит ТОЛЬКО на oauth.bitrix.info).
 *   - REST портала (`client_endpoint` из OAuth-ответа, напр. https://acme.bitrix24.ru/rest/):
 *     вызов методов (`app.info`, `profile`, …). POST `{client_endpoint}{method}`
 *     с `auth=<access_token>` в теле.
 *
 * Клиент stateless: токены/эндпоинты передаются аргументами. Хранение и refresh —
 * в BitrixIntegrationService.
 */

// ─────────────────────────── формы ответов ──────────────────────────────

/** Ответ token-эндпоинта (authorization_code и refresh_token дают одну форму). */
export interface BitrixTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // секунды (обычно 3600)
  member_id: string;
  client_endpoint: string; // REST портала, напр. https://acme.bitrix24.ru/rest/
  server_endpoint?: string; // REST сервера авторизации
  scope?: string;
  domain?: string;
  status?: string;
}

/** Результат REST-метода Bitrix (`{result, ...}` либо `{error, error_description}`). */
export interface BitrixRestResponse<T = unknown> {
  result?: T;
  /** Смещение следующей страницы списочного метода (есть, пока есть ещё данные). */
  next?: number;
  /** Общее число записей списочного метода. */
  total?: number;
  error?: string;
  error_description?: string;
  time?: Record<string, unknown>;
}

// ─────────────────────────── error ──────────────────────────────────────

/**
 * Ошибка вызова Bitrix24. `code` — машинный код от Bitrix (`expired_token`,
 * `invalid_token`, `invalid_grant`, `PAYMENT_REQUIRED`, …). `transient=true`
 * для retryable (429 / 5xx / сетевые). `expired` — токен протух (нужен refresh).
 */
export class BitrixApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | null,
    message: string,
    public readonly transient: boolean,
  ) {
    super(message);
    this.name = 'BitrixApiError';
  }

  /** Токен невалиден/протух — вышестоящий слой делает refresh и retry. */
  get isTokenExpired(): boolean {
    return this.code === 'expired_token' || this.code === 'invalid_token';
  }
}

// ─────────────────────────── client ─────────────────────────────────────

@Injectable()
export class BitrixApiClient {
  private readonly logger = new Logger(BitrixApiClient.name);
  private static readonly TIMEOUT_MS = 20_000;

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  // ─────────────────────── OAuth (oauth.bitrix.info) ────────────────

  /** Обмен `code` (живёт 30 сек) на токены. */
  async exchangeCode(code: string): Promise<BitrixTokenResponse> {
    return this.tokenRequest({
      grant_type: 'authorization_code',
      code,
    });
  }

  /** Обновление токенов по `refresh_token` (живёт 180 дней). */
  async refresh(refreshToken: string): Promise<BitrixTokenResponse> {
    return this.tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
  }

  // ─────────────────────── REST портала ─────────────────────────────

  /**
   * Вызвать REST-метод портала. `clientEndpoint` — из OAuth-ответа (с trailing
   * slash, напр. `https://acme.bitrix24.ru/rest/`). На `error` в теле или не-2xx
   * бросает BitrixApiError (с распознанным `code`).
   */
  async callMethod<T = unknown>(
    clientEndpoint: string,
    accessToken: string,
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const env = await this.restRequest<T>(
      clientEndpoint,
      accessToken,
      method,
      params,
    );
    return (env.result ?? ({} as T)) as T;
  }

  /**
   * Списочный REST-метод с прокачкой пагинации Bitrix (`start`/`next`/`total`,
   * страница 50). Возвращает все записи. `result` может быть массивом или
   * объектом-словарём (тогда берём values). Защитный кап `maxPages` (по умолчанию
   * 400 → до 20000 записей). Refresh токена — обязанность вызывающего слоя.
   */
  async callMethodList<T = unknown>(
    clientEndpoint: string,
    accessToken: string,
    method: string,
    params: Record<string, unknown> = {},
    opts: { maxPages?: number } = {},
  ): Promise<T[]> {
    const maxPages = opts.maxPages ?? 400;
    const acc: T[] = [];
    let start = 0;
    for (let page = 0; page < maxPages; page += 1) {
      const env = await this.restRequest<T[] | Record<string, T>>(
        clientEndpoint,
        accessToken,
        method,
        { ...params, start },
      );
      const result = env.result;
      const batch: T[] = Array.isArray(result)
        ? result
        : result && typeof result === 'object'
          ? (Object.values(result) as T[])
          : [];
      acc.push(...batch);
      // `next` отсутствует → последняя страница. Пустой батч → страховка от цикла.
      if (env.next === undefined || env.next === null || batch.length === 0) {
        break;
      }
      start = env.next;
    }
    return acc;
  }

  /** Низкоуровневый REST-вызов: возвращает полный конверт (result + next + total). */
  private async restRequest<T = unknown>(
    clientEndpoint: string,
    accessToken: string,
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<BitrixRestResponse<T>> {
    const base = clientEndpoint.endsWith('/')
      ? clientEndpoint
      : `${clientEndpoint}/`;
    const url = `${base}${method}`;
    const body = { ...params, auth: accessToken };

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(BitrixApiClient.TIMEOUT_MS),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BitrixApiError(0, null, `network: ${message}`, true);
    }

    const parsed = (await this.parseBody(res)) as BitrixRestResponse<T> | null;

    if (!res.ok || (parsed && parsed.error)) {
      const code = parsed?.error ?? null;
      const description =
        parsed?.error_description ??
        parsed?.error ??
        `Bitrix REST ${method} → HTTP ${res.status}`;
      const transient = res.status === 429 || res.status >= 500;
      throw new BitrixApiError(res.status, code, description, transient);
    }

    return parsed ?? {};
  }

  /** «Проверка соединения»: app.info (требует валидного токена). */
  async getAppInfo(
    clientEndpoint: string,
    accessToken: string,
  ): Promise<Record<string, unknown>> {
    return this.callMethod<Record<string, unknown>>(
      clientEndpoint,
      accessToken,
      'app.info',
    );
  }

  // ─────────────────────── internals ───────────────────────────────

  private async tokenRequest(
    extra: Record<string, string>,
  ): Promise<BitrixTokenResponse> {
    const { clientId, clientSecret, oauthBaseUrl } = this.cfg.bitrix;
    if (!clientId || !clientSecret) {
      // Не сетевая/не транзиентная — конфиг приложения отсутствует.
      throw new BitrixApiError(
        0,
        'bitrix_misconfigured',
        'BITRIX_CLIENT_ID / BITRIX_CLIENT_SECRET не заданы',
        false,
      );
    }

    const qs = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      ...extra,
    }).toString();
    const url = `${oauthBaseUrl}/oauth/token/?${qs}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(BitrixApiClient.TIMEOUT_MS),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BitrixApiError(0, null, `network: ${message}`, true);
    }

    const parsed = (await this.parseBody(res)) as
      | (Partial<BitrixTokenResponse> & {
          error?: string;
          error_description?: string;
        })
      | null;

    if (!res.ok || !parsed?.access_token) {
      const code = parsed?.error ?? null;
      const description =
        parsed?.error_description ??
        parsed?.error ??
        `Bitrix OAuth token → HTTP ${res.status}`;
      const transient = res.status === 429 || res.status >= 500;
      this.logger.warn(`Bitrix token request failed: ${code ?? description}`);
      throw new BitrixApiError(res.status, code, description, transient);
    }

    return parsed as BitrixTokenResponse;
  }

  private async parseBody(res: Response): Promise<unknown> {
    try {
      const text = await res.text();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    } catch {
      return null;
    }
  }
}
