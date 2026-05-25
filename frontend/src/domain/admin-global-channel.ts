/**
 * Доменная модель глобального Channel для Z-Admin (Фаза 5 редизайна).
 *
 * Глобальный канал = `Channel.tenantId IS NULL` (см. partial-unique индекс
 * `channels_global_unique`). На один `kind` допустима ровно одна глобальная
 * строка. Используется, например, для глобального Telegram-бота @kora_bot.
 *
 * Контракт сервера: `backend/src/modules/admin/content/global-channels/...`
 * (префикс `/api/v1/admin/content/global-channels`).
 */

export type GlobalChannelKind =
  | 'telegram_bot'
  | 'max_bot'
  | 'email_smtp'
  | 'email_imap'
  | 'in_app'
  | (string & {});

export const GLOBAL_CHANNEL_KIND_LABELS: Record<string, string> = {
  telegram_bot: 'Telegram бот',
  max_bot: 'Max бот',
  email_smtp: 'Email SMTP',
  email_imap: 'Email IMAP',
  in_app: 'В приложении',
};

export type GlobalChannelStatus =
  | 'active'
  | 'broken'
  | 'disabled'
  | (string & {});

export const GLOBAL_CHANNEL_STATUS_LABELS: Record<string, string> = {
  active: 'Активен',
  broken: 'Сломан',
  disabled: 'Выключен',
};

export type GlobalChannelItemApi = {
  id: string;
  kind: string;
  status: string;
  direction: string;
  /** Произвольный JSON. Секреты в `config.secrets`, мы их редактируем
   *  отдельным password-полем и не отображаем в превью. */
  config: unknown;
  /** Сколько ChannelBinding ссылаются на этот канал. */
  subscribersCount: number;
  brokenReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GlobalChannelListApi = {
  items: GlobalChannelItemApi[];
};

export type GlobalChannelConfigPreview = Record<string, unknown>;

export type GlobalChannelItemDomain = Omit<
  GlobalChannelItemApi,
  'config' | 'createdAt' | 'updatedAt'
> & {
  config: GlobalChannelConfigPreview;
  createdAt: Date;
  updatedAt: Date;
};

export type GlobalChannelListDomain = {
  items: GlobalChannelItemDomain[];
};

function asConfigPreview(v: unknown): GlobalChannelConfigPreview {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: GlobalChannelConfigPreview = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    // Маскируем потенциально чувствительные ключи на этапе мэппинга,
    // чтобы UI не показывал «звёздочки» в превью даже случайно.
    if (/(token|secret|password|key)/i.test(k)) {
      out[k] = '••••••';
    } else {
      out[k] = val;
    }
  }
  return out;
}

export function globalChannelItemFromApi(
  api: GlobalChannelItemApi,
): GlobalChannelItemDomain {
  return {
    id: api.id,
    kind: api.kind,
    status: api.status,
    direction: api.direction,
    subscribersCount: api.subscribersCount,
    brokenReason: api.brokenReason,
    config: asConfigPreview(api.config),
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
  };
}

export function globalChannelListFromApi(
  api: GlobalChannelListApi,
): GlobalChannelListDomain {
  return { items: api.items.map(globalChannelItemFromApi) };
}

export type CreateGlobalChannelRequest = {
  kind: string;
  direction?: string;
  status?: string;
  /** Произвольный конфиг (botToken, etc). */
  config?: Record<string, unknown>;
  /** Отдельное поле для секрета (botToken / SMTP password / …). */
  secret?: string;
};

export type UpdateGlobalChannelRequest = {
  status?: string;
  direction?: string;
  config?: Record<string, unknown>;
  /** При непустом — обновляет секрет. Пустая строка / отсутствие → не трогать. */
  secret?: string;
};
