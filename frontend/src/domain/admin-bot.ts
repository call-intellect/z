export type BotKindApi = "telegram" | "max" | "email_inbox";

export type BotStatusApi =
  | "active"
  | "disabled"
  | "broken"
  | "global_disabled"
  | "not_configured";

export type BotChannelSettingsApiDto = {
  kind: BotKindApi;
  status: BotStatusApi;
  tokenLastChars: string | null;
  tokenIsSet: boolean;
  webhookUrl: string | null;
  webhookSecretIsSet: boolean;
  lastWebhookEventAt: string | null;
  lastWebhookError: string | null;
  globalRps: number | null;
  quietHours: string | null;
  updatedAt: string;
};

export type EmailInboxSettingsApiDto = BotChannelSettingsApiDto & {
  kind: "email_inbox";
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

export type BotChannelSettingsDomain = {
  kind: BotKindApi;
  status: BotStatusApi;
  isLive: boolean;
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
  kind: "email_inbox";
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
  active: "Активен",
  disabled: "Выключен",
  broken: "Ошибка",
  global_disabled: "Глобально выключен",
  not_configured: "Не настроен",
};

export function botChannelFromApi(
  api: BotChannelSettingsApiDto,
): BotChannelSettingsDomain {
  return {
    kind: api.kind,
    status: api.status,
    isLive: api.status === "active" && api.tokenIsSet && api.webhookSecretIsSet,
    isGloballyDisabled: api.status === "global_disabled",
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
    kind: "email_inbox",
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
