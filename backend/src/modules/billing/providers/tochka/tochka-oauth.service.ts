import { randomUUID } from 'node:crypto';

import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../../common/config/index';
import { CryptoService } from '../../../../common/crypto/crypto.service';
import { PrismaService } from '../../../../common/prisma/prisma.service';

import {
  TOCHKA_OAUTH_STATE_KEY,
  TOCHKA_OAUTH_STATE_TTL_MS,
  TOCHKA_OAUTH_TOKENS_KEY,
  TOCHKA_SANDBOX_BEARER_TOKEN,
  TOCHKA_TOKEN_REFRESH_MARGIN_MS,
  type StoredOauthState,
  type StoredOauthTokens,
} from './tochka.types';

interface TochkaTokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  user_id?: string;
}

const TOCHKA_OAUTH_TOKEN_URL = 'https://enter.tochka.com/connect/token';
const TOCHKA_OAUTH_AUTHORIZE_URL = 'https://enter.tochka.com/connect/authorize';
const TOCHKA_OAUTH_CONSENT_URL = 'https://enter.tochka.com/uapi/v1.0/consents';

@Injectable()
export class TochkaOAuthService {
  private readonly logger = new Logger(TochkaOAuthService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
  ) {}

  async ensureOAuthReady(): Promise<void> {
    if (this.cfg.billing.tochka.isSandbox) return;

    const cfg = this.cfg.billing.tochka;
    if (!cfg.clientId || !cfg.clientSecret) {
      this.logger.warn('TOCHKA_CLIENT_ID/SECRET не заданы — OAuth-инициализация пропущена');
      return;
    }

    const stored = await this.getStoredTokens();
    if (stored && !this.isTokenExpired(stored)) {
      this.logger.log(
        `TochkaOAuth: валидный access_token (истекает ${stored.expiresAt ?? 'never'})`,
      );
      return;
    }
    if (stored?.refreshToken) {
      try {
        const refreshed = await this.refreshAndStoreToken(stored.refreshToken);
        this.logger.log(
          `TochkaOAuth: refresh успех (новый expiresAt=${refreshed.expiresAt ?? 'never'})`,
        );
        return;
      } catch (err) {
        this.logger.warn(
          `TochkaOAuth: refresh не сработал — потребуется заново авторизоваться: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    try {
      const url = await this.createAuthorizationUrl();
      this.logger.warn(
        `TOCHKA OAuth: откройте URL в браузере для подключения Точки:\n${TochkaOAuthService.redactAuthorizeUrlForLog(url)}`,
      );
    } catch (err) {
      this.logger.error(
        `Не удалось создать authorize URL: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  static redactAuthorizeUrlForLog(rawUrl: string): string {
    try {
      const u = new URL(rawUrl);
      const mask = (v: string | null): string => {
        if (!v) return '';
        if (v.length <= 6) return '***';
        return `***${v.slice(-4)}`;
      };
      const redactedParams: string[] = [];
      for (const [k, v] of u.searchParams.entries()) {
        if (k === 'client_id' || k === 'consent_id' || k === 'state') {
          redactedParams.push(`${k}=${mask(v)}`);
        } else {
          redactedParams.push(`${k}=${v}`);
        }
      }
      return `${u.origin}${u.pathname}?${redactedParams.join('&')}`;
    } catch {
      return '<invalid-url>';
    }
  }

  async getAccessToken(): Promise<string | null> {
    if (this.cfg.billing.tochka.isSandbox) {
      return TOCHKA_SANDBOX_BEARER_TOKEN;
    }
    const explicit = this.cfg.billing.tochka.jwtToken;
    if (explicit) return explicit;

    const stored = await this.getStoredTokens();
    if (!stored) return null;
    if (!this.isTokenExpired(stored)) return stored.accessToken;
    if (!stored.refreshToken) return null;
    try {
      const refreshed = await this.refreshAndStoreToken(stored.refreshToken);
      return refreshed.accessToken;
    } catch {
      return null;
    }
  }

  async createAuthorizationUrl(): Promise<string> {
    const cfg = this.cfg.billing.tochka;
    const clientId = this.requireConfig('TOCHKA_CLIENT_ID', cfg.clientId);
    const clientSecret = this.requireConfig('TOCHKA_CLIENT_SECRET', cfg.clientSecret);
    const redirectUri = this.requireConfig('TOCHKA_REDIRECT_URI', cfg.redirectUri);
    const scopes = cfg.oauthScopes;
    const permissions = cfg.oauthPermissions;

    const serviceToken = await this.requestServiceToken(clientId, clientSecret, scopes);
    const consentId = await this.createConsent(serviceToken, permissions);

    const state = randomUUID();
    const stateRecord: StoredOauthState = {
      state,
      createdAt: new Date().toISOString(),
      consentId,
      redirectUri,
      scopes,
    };
    await this.prisma.billingProviderConfig.upsert({
      where: { key: TOCHKA_OAUTH_STATE_KEY },
      update: { valueJson: stateRecord as object },
      create: { key: TOCHKA_OAUTH_STATE_KEY, valueJson: stateRecord as object },
    });

    const url = new URL(TOCHKA_OAUTH_AUTHORIZE_URL);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', scopes.join(' '));
    url.searchParams.set('consent_id', consentId);
    return url.toString();
  }

  async handleOAuthCallback(params: {
    code?: string;
    state?: string;
    error?: string;
    errorDescription?: string;
  }): Promise<{ ok: true; expiresAt: string | null; hasRefreshToken: boolean }> {
    if (params.error) {
      throw new BadRequestException(
        `Tochka OAuth error: ${params.error}${
          params.errorDescription ? ` — ${params.errorDescription}` : ''
        }`,
      );
    }
    if (!params.code || !params.state) {
      throw new BadRequestException('code или state отсутствуют в callback');
    }

    const stored = await this.getStoredState();
    if (!stored) {
      throw new BadRequestException(
        'OAuth-сессия не найдена (state потерян?). Запросите authorize URL заново.',
      );
    }
    if (stored.state !== params.state) {
      throw new BadRequestException('state не совпадает');
    }
    const ageMs = Date.now() - new Date(stored.createdAt).getTime();
    if (ageMs > TOCHKA_OAUTH_STATE_TTL_MS) {
      throw new BadRequestException(
        `OAuth state истёк (${Math.round(ageMs / 1000)}с > ${TOCHKA_OAUTH_STATE_TTL_MS / 1000}с)`,
      );
    }

    const cfg = this.cfg.billing.tochka;
    const tokenResponse = await this.postForm<TochkaTokenResponse>(TOCHKA_OAUTH_TOKEN_URL, {
      client_id: this.requireConfig('TOCHKA_CLIENT_ID', cfg.clientId),
      client_secret: this.requireConfig('TOCHKA_CLIENT_SECRET', cfg.clientSecret),
      grant_type: 'authorization_code',
      scope: stored.scopes.join(' '),
      code: params.code,
      redirect_uri: stored.redirectUri,
    });
    const tokens = await this.storeTokens(tokenResponse);
    await this.clearStoredState();
    return {
      ok: true,
      expiresAt: tokens.expiresAt ?? null,
      hasRefreshToken: Boolean(tokens.refreshToken),
    };
  }

  private async requestServiceToken(
    clientId: string,
    clientSecret: string,
    scopes: string[],
  ): Promise<string> {
    const r = await this.postForm<TochkaTokenResponse>(TOCHKA_OAUTH_TOKEN_URL, {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
      scope: scopes.join(' '),
    });
    if (!r.access_token) {
      throw new BadRequestException('Точка не вернула service access_token');
    }
    return r.access_token;
  }

  private async createConsent(serviceToken: string, permissions: string[]): Promise<string> {
    const expirationDateTime = this.cfg.billing.tochka.oauthConsentExpiresAt;
    const response = await fetch(TOCHKA_OAUTH_CONSENT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        Data: {
          permissions,
          ...(expirationDateTime ? { expirationDateTime } : {}),
        },
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new BadRequestException(
        `Tochka consent failed: ${response.status} ${text.slice(0, 200)}`,
      );
    }
    const json = (await response.json()) as { Data?: { consentId?: string } };
    const consentId = json?.Data?.consentId;
    if (!consentId) {
      throw new BadRequestException('Точка не вернула consentId');
    }
    return consentId;
  }

  private async refreshAndStoreToken(refreshToken: string): Promise<StoredOauthTokens> {
    const cfg = this.cfg.billing.tochka;
    const r = await this.postForm<TochkaTokenResponse>(TOCHKA_OAUTH_TOKEN_URL, {
      client_id: this.requireConfig('TOCHKA_CLIENT_ID', cfg.clientId),
      client_secret: this.requireConfig('TOCHKA_CLIENT_SECRET', cfg.clientSecret),
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    return this.storeTokens(r, refreshToken);
  }

  private async postForm<T>(url: string, payload: Record<string, string>): Promise<T> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(payload).toString(),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new BadRequestException(`Tochka OAuth: HTTP ${response.status} ${text.slice(0, 200)}`);
    }
    return (await response.json()) as T;
  }

  private async storeTokens(
    r: TochkaTokenResponse,
    fallbackRefreshToken?: string,
  ): Promise<StoredOauthTokens> {
    if (!r.access_token) {
      throw new BadRequestException('Точка не вернула access_token');
    }
    const obtainedAt = new Date();
    const expiresAt =
      typeof r.expires_in === 'number'
        ? new Date(obtainedAt.getTime() + r.expires_in * 1000)
        : undefined;
    const stored: StoredOauthTokens = {
      accessToken: r.access_token,
      refreshToken: r.refresh_token ?? fallbackRefreshToken,
      tokenType: r.token_type ?? 'bearer',
      expiresAt: expiresAt?.toISOString(),
      obtainedAt: obtainedAt.toISOString(),
      userId: r.user_id,
    };
    const encrypted = this.encryptTokens(stored);
    await this.prisma.billingProviderConfig.upsert({
      where: { key: TOCHKA_OAUTH_TOKENS_KEY },
      update: { valueJson: encrypted },
      create: { key: TOCHKA_OAUTH_TOKENS_KEY, valueJson: encrypted },
    });
    return stored;
  }

  private async getStoredTokens(): Promise<StoredOauthTokens | null> {
    const row = await this.prisma.billingProviderConfig.findUnique({
      where: { key: TOCHKA_OAUTH_TOKENS_KEY },
    });
    if (!row) return null;
    return this.decryptTokensFromStorage(row.valueJson);
  }

  private encryptTokens(stored: StoredOauthTokens): { enc: string } {
    const json = JSON.stringify(stored);
    return { enc: this.crypto.encrypt(json) };
  }

  private decryptTokensFromStorage(raw: unknown): StoredOauthTokens | null {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    if (typeof obj['enc'] === 'string') {
      try {
        const json = this.crypto.decrypt(obj['enc'] as string);
        return JSON.parse(json) as StoredOauthTokens;
      } catch (err) {
        this.logger.error(
          `audit Б5: не удалось расшифровать tochka-oauth tokens: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
    }
    if (typeof obj['accessToken'] === 'string' || typeof obj['refreshToken'] === 'string') {
      this.logger.warn(
        'audit Б5: tochka-oauth tokens в plain-формате. ' +
          'Запустите scripts/patch-encrypt-tochka-oauth.ts',
      );
      return obj as unknown as StoredOauthTokens;
    }
    return null;
  }

  private async getStoredState(): Promise<StoredOauthState | null> {
    const row = await this.prisma.billingProviderConfig.findUnique({
      where: { key: TOCHKA_OAUTH_STATE_KEY },
    });
    return (row?.valueJson as unknown as StoredOauthState) ?? null;
  }

  private async clearStoredState(): Promise<void> {
    await this.prisma.billingProviderConfig.deleteMany({
      where: { key: TOCHKA_OAUTH_STATE_KEY },
    });
  }

  private isTokenExpired(t: StoredOauthTokens): boolean {
    if (!t.expiresAt) return false;
    const ts = new Date(t.expiresAt).getTime();
    return Number.isFinite(ts) && ts - Date.now() < TOCHKA_TOKEN_REFRESH_MARGIN_MS;
  }

  private requireConfig<T>(name: string, value: T | undefined | null): T {
    if (value == null || value === '') {
      throw new BadRequestException(`${name} не задан в ENV`);
    }
    return value;
  }
}
