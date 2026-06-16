import type {
  ChannelBindingApi,
  ChannelBindingPreferencesApi,
  ChannelEntryApi,
} from "@/api/me-channels.api";

export type TelegramChannelStatus =
  | "linked"
  | "not_linked"
  | "bot_blocked"
  | "channel_disabled"
  | "channel_not_configured";

const STATUS_LABELS: Record<TelegramChannelStatus, string> = {
  linked: "Привязан",
  not_linked: "Не привязан",
  bot_blocked: "Бот заблокирован",
  channel_disabled: "Канал выключен",
  channel_not_configured: "Не настроен",
};

export function telegramStatusLabel(s: TelegramChannelStatus): string {
  return STATUS_LABELS[s];
}

export type TelegramChannelView = {
  channelId: string;
  status: TelegramChannelStatus;
  statusLabel: string;
  binding: {
    id: string;
    externalId: string;
    verifiedAt: Date | null;
    preferences: TelegramChannelPreferences;
  } | null;
  botUsername: string | null;
};

export function mapTelegramChannelEntry(
  api: ChannelEntryApi,
): TelegramChannelView | null {
  if (api.channel.kind !== "telegram_bot") return null;

  const channelDisabled =
    api.channel.status === "disabled" || api.channel.status === "broken";
  const binding = api.binding;
  const verified = binding?.verifiedAt != null;

  let status: TelegramChannelStatus;
  if (api.channel.configured === false) status = "channel_not_configured";
  else if (channelDisabled) status = "channel_disabled";
  else if (!binding || !verified) status = "not_linked";
  else if (isBindingBotBlocked(binding)) status = "bot_blocked";
  else status = "linked";

  return {
    channelId: api.channel.id,
    status,
    statusLabel: telegramStatusLabel(status),
    botUsername: api.channel.botUsername ?? null,
    binding: binding
      ? {
          id: binding.id,
          externalId: binding.externalId,
          verifiedAt: binding.verifiedAt ? new Date(binding.verifiedAt) : null,
          preferences: parseTelegramPreferences(binding.preferences),
        }
      : null,
  };
}

function isBindingBotBlocked(binding: ChannelBindingApi): boolean {
  const disabledUntil = binding.preferences?.disabledUntil;
  if (!disabledUntil) return false;
  const t = Date.parse(disabledUntil);
  if (Number.isNaN(t)) return false;
  return t > Date.now();
}

export const TELEGRAM_NOTIFICATION_KEYS = {
  tasksDueSoon: "notif.tasks.due_soon",
  probeQuestion: "probe.question",
  mention: "notif.mention",
  dailyDigest: "notif.digest.daily",
  weeklyReport: "notif.digest.weekly",
  taskNoDueDate: "notif.tasks.no_due_date",
  teamDecisionsWithoutMe: "notif.decisions.team_without_me",
} as const;

export type TelegramNotificationKey =
  (typeof TELEGRAM_NOTIFICATION_KEYS)[keyof typeof TELEGRAM_NOTIFICATION_KEYS];

export const TELEGRAM_DEFAULT_ALLOW: ReadonlyArray<TelegramNotificationKey> = [
  TELEGRAM_NOTIFICATION_KEYS.tasksDueSoon,
  TELEGRAM_NOTIFICATION_KEYS.probeQuestion,
  TELEGRAM_NOTIFICATION_KEYS.mention,
];

export type TelegramQuietHours = {
  start: string;
  end: string;
  allowCritical: boolean;
};

export const TELEGRAM_DEFAULT_QUIET_HOURS: TelegramQuietHours = {
  start: "22:00",
  end: "08:00",
  allowCritical: true,
};

export type TelegramChannelPreferences = {
  allow: ReadonlyArray<TelegramNotificationKey>;
  quietHours: TelegramQuietHours;
  disabledUntilIso: string | null;
};

export function parseTelegramPreferences(
  api: ChannelBindingPreferencesApi | null,
): TelegramChannelPreferences {
  const allow = Array.isArray(api?.eventTypeAllow)
    ? (api!.eventTypeAllow.filter((k) =>
        Object.values(TELEGRAM_NOTIFICATION_KEYS).includes(
          k as TelegramNotificationKey,
        ),
      ) as TelegramNotificationKey[])
    : [...TELEGRAM_DEFAULT_ALLOW];

  return {
    allow,
    quietHours:
      parseQuietHours(api?.quietHours) ?? TELEGRAM_DEFAULT_QUIET_HOURS,
    disabledUntilIso: api?.disabledUntil ?? null,
  };
}

function parseQuietHours(raw: string | undefined): TelegramQuietHours | null {
  if (!raw) return null;
  const [window, ...flags] = raw.split("|");
  const m = window?.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
  if (!m) return null;
  return {
    start: m[1]!,
    end: m[2]!,
    allowCritical: flags.includes("critical"),
  };
}

export function serializeQuietHours(qh: TelegramQuietHours): string {
  const base = `${qh.start}-${qh.end}`;
  return qh.allowCritical ? `${base}|critical` : base;
}

export function buildTelegramPreferencesPayload(args: {
  allow: ReadonlyArray<TelegramNotificationKey>;
  quietHours: TelegramQuietHours;
  disabledUntilIso: string | null;
}): ChannelBindingPreferencesApi {
  return {
    eventTypeAllow: [...args.allow],
    quietHours: serializeQuietHours(args.quietHours),
    ...(args.disabledUntilIso ? { disabledUntil: args.disabledUntilIso } : {}),
  };
}

export type TelegramNotificationOption = {
  key: TelegramNotificationKey;
  label: string;
  hint?: string;
  group: "inbox" | "digest" | "team";
};

export const TELEGRAM_NOTIFICATION_OPTIONS: ReadonlyArray<TelegramNotificationOption> =
  [
    {
      key: TELEGRAM_NOTIFICATION_KEYS.tasksDueSoon,
      label: "Задачи на меня со сроком сегодня или завтра",
      group: "inbox",
    },
    {
      key: TELEGRAM_NOTIFICATION_KEYS.probeQuestion,
      label: "Короткие вопросы от Коры",
      hint: "Когда AI уточняет деталь, чтобы пополнить память компании.",
      group: "inbox",
    },
    {
      key: TELEGRAM_NOTIFICATION_KEYS.mention,
      label: "Когда меня упомянули",
      group: "inbox",
    },
    {
      key: TELEGRAM_NOTIFICATION_KEYS.dailyDigest,
      label: "Ежедневный дайджест утром",
      hint: "Короткая сводка задач и важных событий за вчера.",
      group: "digest",
    },
    {
      key: TELEGRAM_NOTIFICATION_KEYS.weeklyReport,
      label: "Еженедельный отчёт",
      group: "digest",
    },
    {
      key: TELEGRAM_NOTIFICATION_KEYS.taskNoDueDate,
      label: "Новые задачи без срочного срока",
      group: "team",
    },
    {
      key: TELEGRAM_NOTIFICATION_KEYS.teamDecisionsWithoutMe,
      label: "Решения команды, в которых я не участвовал",
      group: "team",
    },
  ];
