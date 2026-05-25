/**
 * Доменная модель для `/admin/integrations/bots` — Conversational боты
 * (Telegram / Max / Email-inbox). Фаза 6 редизайна Z-Admin.
 *
 * Контракт backend: `AdminBotsController` под префиксом
 * `/api/v1/admin/integrations/bots` (планируется). На момент сборки фронта
 * эндпоинты могут отсутствовать — UI ловит 404 и показывает `AdminEmpty`.
 *
 * Layer split: ApiDto — что приходит по проводу; DomainModel — типобезопасные
 * значения с распарсенными датами и UI-флагами.
 */

// ────────────────────────── ApiDto ──────────────────────────

export type BotKindApi = 'telegram' | 'max' | 'email_inbox';

export type BotStatusApi =
  | 'active'
  | 'disabled'
  | 'broken'
  | 'global_disabled'
  | 'not_configured';

/** Базовая «карточка» бота-канала. */
export type BotChannelSettingsApiDto = {
  kind: BotKindApi;
  status: BotStatusApi;
  /** Замаскированный токен, последние 4 символа. */
  tokenLastChars: string | null;
  tokenIsSet: boolean;
  webhookUrl: string | null;
  webhookSecretIsSet: boolean;
  /** Последнее зарегистрированное входящее событие webhook'а. */
  lastWebhookEventAt: string | null;
  lastWebhookError: string | null;
  /** Глобальный rate-limit (запросов/сек). */
  globalRps: number | null;
  /** «Тихие часы» — диапазон в формате `HH:MM-HH:MM` либо null. */
  quietHours: string | null;
  /** Когда последний раз изменялись настройки. */
  updatedAt: string;
};

/** Email-inbox имеет дополнительные поля host/port/folder. */
export type EmailInboxSettingsApiDto = BotChannelSettingsApiDto & {
  kind: 'email_inbox';
  host: string | null;
  port: number | null;
  user: string | null;
  folder: string | null;
  lastFetchAt: string | null;
};

export type BotsOverviewApiDto = {
  telegram: BotChannelSettingsApiDto | null;
  max: BotChannelSettingsApiDto | null;
  emailInbox: EmailInboxSettingsApiDto | null;
};

// ────────────────────────── DomainModel ──────────────────────────

export type BotChannelSettingsDomain = {
  kind: BotKindApi;
  status: BotStatusApi;
  /** Удобный флаг для UI: «всё работает». */
  isLive: boolean;
  /** «Бот выключен главным админом». */
  isGloballyDisabled: boolean;
  tokenLastChars: string | null;
  tokenIsSet: boolean;
  webhookUrl: string | null;
  webhookSecretIsSet: boolean;
  lastWebhookEventAt: Date | null;
  lastWebhookError: string | null;
  globalRps: number | null;
  quietHours: string | null;
  updatedAt: Date;
};

export type EmailInboxSettingsDomain = BotChannelSettingsDomain & {
  kind: 'email_inbox';
  host: string | null;
  port: number | null;
  user: string | null;
  folder: string | null;
  lastFetchAt: Date | null;
};

export type BotsOverviewDomain = {
  telegram: BotChannelSettingsDomain | null;
  max: BotChannelSettingsDomain | null;
  emailInbox: EmailInboxSettingsDomain | null;
};

export const BOT_STATUS_LABELS: Record<BotStatusApi, string> = {
  active: 'Активен',
  disabled: 'Выключен',
  broken: 'Ошибка',
  global_disabled: 'Глобально выключен',
  not_configured: 'Не настроен',
};

// ────────────────────────── Mappers ──────────────────────────

export function botChannelFromApi(
  api: BotChannelSettingsApiDto,
): BotChannelSettingsDomain {
  return {
    kind: api.kind,
    status: api.status,
    isLive:
      api.status === 'active' && api.tokenIsSet && api.webhookSecretIsSet,
    isGloballyDisabled: api.status === 'global_disabled',
    tokenLastChars: api.tokenLastChars,
    tokenIsSet: api.tokenIsSet,
    webhookUrl: api.webhookUrl,
    webhookSecretIsSet: api.webhookSecretIsSet,
    lastWebhookEventAt: api.lastWebhookEventAt
      ? new Date(api.lastWebhookEventAt)
      : null,
    lastWebhookError: api.lastWebhookError,
    globalRps: api.globalRps,
    quietHours: api.quietHours,
    updatedAt: new Date(api.updatedAt),
  };
}

export function emailInboxFromApi(
  api: EmailInboxSettingsApiDto,
): EmailInboxSettingsDomain {
  return {
    ...botChannelFromApi(api),
    kind: 'email_inbox',
    host: api.host,
    port: api.port,
    user: api.user,
    folder: api.folder,
    lastFetchAt: api.lastFetchAt ? new Date(api.lastFetchAt) : null,
  };
}

export function botsOverviewFromApi(
  api: BotsOverviewApiDto,
): BotsOverviewDomain {
  return {
    telegram: api.telegram ? botChannelFromApi(api.telegram) : null,
    max: api.max ? botChannelFromApi(api.max) : null,
    emailInbox: api.emailInbox ? emailInboxFromApi(api.emailInbox) : null,
  };
}
