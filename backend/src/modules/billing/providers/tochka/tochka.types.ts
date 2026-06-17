export interface TochkaEnvelope<T> {
  Data: T;
  Links?: Record<string, unknown>;
  Meta?: Record<string, unknown>;
}

export interface StoredOauthTokens {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresAt?: string;
  obtainedAt: string;
  userId?: string;
}

export interface StoredOauthState {
  state: string;
  createdAt: string;
  consentId: string;
  redirectUri: string;
  scopes: string[];
}

export interface StoredWebhookRegistration {
  url: string;
  events: string[];
  webhookIds: string[];
  registeredAt: string;
}

export const TOCHKA_OAUTH_TOKENS_KEY = 'tochka.production.oauth_tokens';
export const TOCHKA_OAUTH_STATE_KEY = 'tochka.production.oauth_state';
export const TOCHKA_WEBHOOK_REGISTRATION_KEY = 'tochka.webhook_registration';

export const TOCHKA_OAUTH_STATE_TTL_MS = 15 * 60 * 1000;
export const TOCHKA_TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
export const TOCHKA_SANDBOX_BEARER_TOKEN = 'sandbox.jwt.token';
