/**
 * Доменная модель для главной админки Z — глобальный Telegram-бот (β-9 Phase 4).
 *
 * Контракт backend: `AdminTelegramBotService` (см.
 * `backend/src/modules/admin/system/telegram-bot/admin-telegram-bot.dto.ts`).
 *
 * Layer split: ApiDto — то, что приходит по проводу;
 * DomainModel — типобезопасные значения с распарсенными датами и
 * сценарными полями для UI.
 */

// ────────────────────────── ApiDto ──────────────────────────

export type TelegramBotStatusApi =
  | 'active'
  | 'disabled'
  | 'broken'
  | 'global_disabled';

export type TelegramBotTemplatesApi = {
  welcome: string;
  notLinked: string;
  employeeOffboarded: string;
  orgFrozen: string;
};

export type TelegramBotSettingsApiDto = {
  channelExists: boolean;
  channelId: string | null;
  tokenIsSet: boolean;
  tokenLastChars: string | null;
  webhookUrl: string;
  webhookSecretIsSet: boolean;
  botUsername: string | null;
  status: TelegramBotStatusApi;
  brokenReason: string | null;
  templates: TelegramBotTemplatesApi;
  updatedAt: string;
};

export type TelegramBotBindingStatusApi =
  | 'linked'
  | 'pending'
  | 'no_membership'
  | 'bot_blocked'
  | 'inactive';

export type TelegramBotBindingApiDto = {
  id: string;
  orgId: string | null;
  orgName: string | null;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  status: TelegramBotBindingStatusApi;
  linkedAt: string | null;
  lastInboundAt: string | null;
  inboundCount: number;
  outboundCount: number;
};

export type TelegramBotBindingsPageApiDto = {
  items: TelegramBotBindingApiDto[];
  total: number;
  page: number;
  pageSize: number;
};

// ────────────────────────── DomainModel ──────────────────────────

export type TelegramBotDomain = {
  channelExists: boolean;
  channelId: string | null;
  tokenIsSet: boolean;
  tokenLastChars: string | null;
  webhookUrl: string;
  webhookSecretIsSet: boolean;
  botUsername: string | null;
  status: TelegramBotStatusApi;
  /** Удобный флаг для UI: «всё ли работает у бота». */
  isLive: boolean;
  /** Удобный флаг для UI: «бот выключен главным админом». */
  isGloballyDisabled: boolean;
  brokenReason: string | null;
  templates: TelegramBotTemplatesApi;
  updatedAt: Date;
};

export type TelegramBotBindingDomain = {
  id: string;
  orgId: string | null;
  orgName: string | null;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  status: TelegramBotBindingStatusApi;
  /** Локализованная подпись статуса для UI. */
  statusLabel: string;
  linkedAt: Date | null;
  lastInboundAt: Date | null;
  inboundCount: number;
  outboundCount: number;
};

export type TelegramBotBindingsPageDomain = {
  items: TelegramBotBindingDomain[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

// ────────────────────────── Mappers ──────────────────────────

export function telegramBotFromApi(
  api: TelegramBotSettingsApiDto,
): TelegramBotDomain {
  return {
    channelExists: api.channelExists,
    channelId: api.channelId,
    tokenIsSet: api.tokenIsSet,
    tokenLastChars: api.tokenLastChars,
    webhookUrl: api.webhookUrl,
    webhookSecretIsSet: api.webhookSecretIsSet,
    botUsername: api.botUsername,
    status: api.status,
    isLive:
      api.channelExists &&
      api.status === 'active' &&
      api.tokenIsSet &&
      api.webhookSecretIsSet,
    isGloballyDisabled: api.status === 'global_disabled',
    brokenReason: api.brokenReason,
    templates: api.templates,
    updatedAt: new Date(api.updatedAt),
  };
}

const BINDING_STATUS_LABEL: Record<TelegramBotBindingStatusApi, string> = {
  linked: 'Привязан, активен',
  pending: 'Ожидает подтверждения',
  no_membership: 'Без компании',
  bot_blocked: 'Бот заблокирован сотрудником',
  inactive: 'Неактивен (более 30 дней)',
};

export function telegramBotBindingFromApi(
  api: TelegramBotBindingApiDto,
): TelegramBotBindingDomain {
  return {
    id: api.id,
    orgId: api.orgId,
    orgName: api.orgName,
    userId: api.userId,
    userEmail: api.userEmail,
    userName: api.userName,
    status: api.status,
    statusLabel: BINDING_STATUS_LABEL[api.status],
    linkedAt: api.linkedAt ? new Date(api.linkedAt) : null,
    lastInboundAt: api.lastInboundAt ? new Date(api.lastInboundAt) : null,
    inboundCount: api.inboundCount,
    outboundCount: api.outboundCount,
  };
}

export function telegramBotBindingsPageFromApi(
  api: TelegramBotBindingsPageApiDto,
): TelegramBotBindingsPageDomain {
  return {
    items: api.items.map(telegramBotBindingFromApi),
    total: api.total,
    page: api.page,
    pageSize: api.pageSize,
    hasMore: api.page * api.pageSize < api.total,
  };
}
