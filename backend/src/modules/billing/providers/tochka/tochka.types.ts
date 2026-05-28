/**
 * Внутренние типы для адаптера Точка Банк.
 *
 * Точка использует «конверт» формат `{ Data, Links, Meta }` в response.
 * Часть полей в `Data` отличается между acquiring/invoice/openBanking —
 * описываем общий envelope + типы по конкретным операциям через casts.
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §7.3 + port-brief §6.
 */

export interface TochkaEnvelope<T> {
  Data: T;
  Links?: Record<string, unknown>;
  Meta?: Record<string, unknown>;
}

/** Сохранённые OAuth-токены в BillingProviderConfig. */
export interface StoredOauthTokens {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresAt?: string; // ISO
  obtainedAt: string; // ISO
  userId?: string;
}

/** OAuth-state (для проверки callback'а Точки). */
export interface StoredOauthState {
  state: string;
  createdAt: string; // ISO
  consentId: string;
  redirectUri: string;
  scopes: string[];
}

/** Запись о зарегистрированном webhook'е в BillingProviderConfig. */
export interface StoredWebhookRegistration {
  url: string;
  events: string[];
  webhookIds: string[];
  registeredAt: string; // ISO
}

/** Ключи в BillingProviderConfig (KV-таблица). */
export const TOCHKA_OAUTH_TOKENS_KEY = 'tochka.production.oauth_tokens';
export const TOCHKA_OAUTH_STATE_KEY = 'tochka.production.oauth_state';
export const TOCHKA_WEBHOOK_REGISTRATION_KEY = 'tochka.webhook_registration';

/** TTL OAuth-state'а от создания до использования callback'ом (15 минут). */
export const TOCHKA_OAUTH_STATE_TTL_MS = 15 * 60 * 1000;
/** Запас на refresh access_token'а до его истечения (5 минут). */
export const TOCHKA_TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
/** Sandbox bearer token (хардкод из документации Точки). */
export const TOCHKA_SANDBOX_BEARER_TOKEN = 'sandbox.jwt.token';
