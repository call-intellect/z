import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../common/config/index';

export interface BitrixTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  member_id: string;
  client_endpoint: string;
  server_endpoint?: string;
  scope?: string;
  domain?: string;
  status?: string;
}

export interface BitrixRestResponse<T = unknown> {
  result?: T;
  next?: number;
  total?: number;
  error?: string;
  error_description?: string;
  time?: Record<string, unknown>;
}

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

  get isTokenExpired(): boolean {
    return this.code === 'expired_token' || this.code === 'invalid_token';
  }
}

@Injectable()
export class BitrixApiClient {
  private readonly logger = new Logger(BitrixApiClient.name);
  private static readonly TIMEOUT_MS = 20_000;

  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {}

  async exchangeCode(code: string): Promise<BitrixTokenResponse> {
    return this.tokenRequest({
      grant_type: 'authorization_code',
      code,
    });
  }

  async refresh(refreshToken: string): Promise<BitrixTokenResponse> {
    return this.tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
  }

  async callMethod<T = unknown>(
    clientEndpoint: string,
    accessToken: string,
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const env = await this.restRequest<T>(clientEndpoint, accessToken, method, params);
    return (env.result ?? ({} as T)) as T;
  }

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
      if (env.next === undefined || env.next === null || batch.length === 0) {
        break;
      }
      start = env.next;
    }
    return acc;
  }

  private async restRequest<T = unknown>(
    clientEndpoint: string,
    accessToken: string,
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<BitrixRestResponse<T>> {
    const base = clientEndpoint.endsWith('/') ? clientEndpoint : `${clientEndpoint}/`;
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
        parsed?.error_description ?? parsed?.error ?? `Bitrix REST ${method} → HTTP ${res.status}`;
      const transient = res.status === 429 || res.status >= 500;
      throw new BitrixApiError(res.status, code, description, transient);
    }

    return parsed ?? {};
  }

  async getAppInfo(clientEndpoint: string, accessToken: string): Promise<Record<string, unknown>> {
    return this.callMethod<Record<string, unknown>>(clientEndpoint, accessToken, 'app.info');
  }

  private async tokenRequest(extra: Record<string, string>): Promise<BitrixTokenResponse> {
    const { clientId, clientSecret, oauthBaseUrl } = this.cfg.bitrix;
    if (!clientId || !clientSecret) {
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
        parsed?.error_description ?? parsed?.error ?? `Bitrix OAuth token → HTTP ${res.status}`;
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
