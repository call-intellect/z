export type GlobalChannelKind =
  | "telegram_bot"
  | "max_bot"
  | "email_smtp"
  | "email_imap"
  | "in_app"
  | (string & {});

export const GLOBAL_CHANNEL_KIND_LABELS: Record<string, string> = {
  telegram_bot: "Telegram бот",
  max_bot: "Max бот",
  email_smtp: "Email SMTP",
  email_imap: "Email IMAP",
  in_app: "В приложении",
};

export type GlobalChannelStatus =
  | "active"
  | "broken"
  | "disabled"
  | (string & {});

export const GLOBAL_CHANNEL_STATUS_LABELS: Record<string, string> = {
  active: "Активен",
  broken: "Сломан",
  disabled: "Выключен",
};

export type GlobalChannelItemApi = {
  id: string;
  kind: string;
  status: string;
  direction: string;
  config: unknown;
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
  "config" | "createdAt" | "updatedAt"
> & {
  config: GlobalChannelConfigPreview;
  createdAt: Date;
  updatedAt: Date;
};

export type GlobalChannelListDomain = {
  items: GlobalChannelItemDomain[];
};

function asConfigPreview(v: unknown): GlobalChannelConfigPreview {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: GlobalChannelConfigPreview = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (/(token|secret|password|key)/i.test(k)) {
      out[k] = "••••••";
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
  config?: Record<string, unknown>;
  secret?: string;
};

export type UpdateGlobalChannelRequest = {
  status?: string;
  direction?: string;
  config?: Record<string, unknown>;
  secret?: string;
};
