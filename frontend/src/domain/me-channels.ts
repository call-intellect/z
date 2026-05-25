/**
 * β-9 / Phase 6 (2026-05-25) — DomainModel для кабинета сотрудника
 * (страницы `/me/channels` и `/me/notifications-telegram`).
 *
 * Слой ApiDto → DomainModel → UiModel (см. правило `frontend-rules`).
 * Здесь живёт Telegram-специфика: разбор статуса канала
 * («привязан»/«не привязан»/«бот заблокирован»), parse/serialize
 * preferences (quietHours, eventTypeAllow, disabledUntil).
 */

import type {
  ChannelBindingApi,
  ChannelBindingPreferencesApi,
  ChannelEntryApi,
} from '@/api/me-channels.api';

// ─────────────────────────── статус Telegram-карточки ───────────────────

export type TelegramChannelStatus =
  | 'linked'
  | 'not_linked'
  | 'bot_blocked'
  | 'channel_disabled';

const STATUS_LABELS: Record<TelegramChannelStatus, string> = {
  linked: 'Привязан',
  not_linked: 'Не привязан',
  bot_blocked: 'Бот заблокирован',
  channel_disabled: 'Канал выключен',
};

export function telegramStatusLabel(s: TelegramChannelStatus): string {
  return STATUS_LABELS[s];
}

/**
 * UI-модель Telegram-канала. Собирает удобное представление для карточки:
 * лейбл, статус, привязка, preferences.
 */
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
};

export function mapTelegramChannelEntry(
  api: ChannelEntryApi,
): TelegramChannelView | null {
  if (api.channel.kind !== 'telegram_bot') return null;

  const channelDisabled =
    api.channel.status === 'disabled' || api.channel.status === 'broken';
  const binding = api.binding;
  const verified = binding?.verifiedAt != null;

  let status: TelegramChannelStatus;
  if (channelDisabled) status = 'channel_disabled';
  else if (!binding || !verified) status = 'not_linked';
  else if (isBindingBotBlocked(binding)) status = 'bot_blocked';
  else status = 'linked';

  return {
    channelId: api.channel.id,
    status,
    statusLabel: telegramStatusLabel(status),
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

/**
 * Эвристика «бот заблокирован сотрудником» — backend помечает её в
 * `preferences.disabledUntil` (как ISO-строка) после получения от Telegram
 * ошибки `403 bot was blocked by the user` (см. SBA β-1). Если значение
 * есть и в будущем — считаем «заблокирован».
 */
function isBindingBotBlocked(binding: ChannelBindingApi): boolean {
  const disabledUntil = binding.preferences?.disabledUntil;
  if (!disabledUntil) return false;
  const t = Date.parse(disabledUntil);
  if (Number.isNaN(t)) return false;
  return t > Date.now();
}

// ─────────────────────────── preferences (Telegram) ─────────────────────

/**
 * Категории уведомлений, видимые на странице «Уведомления в Telegram».
 * Решение 10 ТЗ (2026-05-25):
 *   по умолчанию включены: задачи на меня, короткие пробы AI, упоминания;
 *   выключены: дайджест дня, недельный отчёт, новые задачи без срочного
 *   срока, решения команды без меня.
 *
 * Внутренние ключи (`eventType`) — это identifier'ы из ConversationalService.
 * Префикс `notif.` — конвенция: «эти ключи попадают в `eventTypeAllow`
 * как whitelist». Если allow-список не задан — backend считает «всё
 * разрешено» (legacy α-1 behavior).
 */
export const TELEGRAM_NOTIFICATION_KEYS = {
  tasksDueSoon: 'notif.tasks.due_soon',
  probeQuestion: 'probe.question',
  mention: 'notif.mention',
  dailyDigest: 'notif.digest.daily',
  weeklyReport: 'notif.digest.weekly',
  taskNoDueDate: 'notif.tasks.no_due_date',
  teamDecisionsWithoutMe: 'notif.decisions.team_without_me',
} as const;

export type TelegramNotificationKey =
  (typeof TELEGRAM_NOTIFICATION_KEYS)[keyof typeof TELEGRAM_NOTIFICATION_KEYS];

export const TELEGRAM_DEFAULT_ALLOW: ReadonlyArray<TelegramNotificationKey> = [
  TELEGRAM_NOTIFICATION_KEYS.tasksDueSoon,
  TELEGRAM_NOTIFICATION_KEYS.probeQuestion,
  TELEGRAM_NOTIFICATION_KEYS.mention,
];

export type TelegramQuietHours = {
  /** Начало тихих часов в формате `HH:mm` (24h), локальное время. */
  start: string;
  /** Конец тихих часов в формате `HH:mm`. Если `end < start` — окно
   *  пересекает полночь (например, 22:00 → 08:00). */
  end: string;
  /** Срочные уведомления всё равно отправляются (по умолчанию `true`). */
  allowCritical: boolean;
};

export const TELEGRAM_DEFAULT_QUIET_HOURS: TelegramQuietHours = {
  start: '22:00',
  end: '08:00',
  allowCritical: true,
};

export type TelegramChannelPreferences = {
  /** Whitelist eventType'ов; пустой = «всё разрешено» (legacy). */
  allow: ReadonlyArray<TelegramNotificationKey>;
  quietHours: TelegramQuietHours;
  /** Сохранённое `disabledUntil` (если backend пометил «заблокирован»). */
  disabledUntilIso: string | null;
};

/**
 * ApiDto → DomainModel. Безопасно к нестандартным полям: всё лишнее
 * игнорируется; невалидный `quietHours` падает в default.
 */
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
    quietHours: parseQuietHours(api?.quietHours) ?? TELEGRAM_DEFAULT_QUIET_HOURS,
    disabledUntilIso: api?.disabledUntil ?? null,
  };
}

/**
 * Внутренний контракт строки `quietHours`: `"HH:mm-HH:mm"` или
 * `"HH:mm-HH:mm|critical"`. Если есть `|critical` — `allowCritical=true`.
 * Это сохраняется в `ChannelBindingPreferences.quietHours` строкой,
 * совместимой с уже существующим back-схема (Wave 2 ввела `quietHours`
 * как строку), и не требует миграции.
 */
function parseQuietHours(raw: string | undefined): TelegramQuietHours | null {
  if (!raw) return null;
  const [window, ...flags] = raw.split('|');
  const m = window?.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
  if (!m) return null;
  return {
    start: m[1]!,
    end: m[2]!,
    allowCritical: flags.includes('critical'),
  };
}

export function serializeQuietHours(qh: TelegramQuietHours): string {
  const base = `${qh.start}-${qh.end}`;
  return qh.allowCritical ? `${base}|critical` : base;
}

/** DomainModel → ApiDto для PATCH preferences. */
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

// ─────────────────────────── UI-копи для галочек ────────────────────────

export type TelegramNotificationOption = {
  key: TelegramNotificationKey;
  label: string;
  hint?: string;
  group: 'inbox' | 'digest' | 'team';
};

export const TELEGRAM_NOTIFICATION_OPTIONS: ReadonlyArray<TelegramNotificationOption> = [
  {
    key: TELEGRAM_NOTIFICATION_KEYS.tasksDueSoon,
    label: 'Задачи на меня со сроком сегодня или завтра',
    group: 'inbox',
  },
  {
    key: TELEGRAM_NOTIFICATION_KEYS.probeQuestion,
    label: 'Короткие вопросы от Коры',
    hint: 'Когда AI уточняет деталь, чтобы пополнить память компании.',
    group: 'inbox',
  },
  {
    key: TELEGRAM_NOTIFICATION_KEYS.mention,
    label: 'Когда меня упомянули',
    group: 'inbox',
  },
  {
    key: TELEGRAM_NOTIFICATION_KEYS.dailyDigest,
    label: 'Ежедневный дайджест утром',
    hint: 'Короткая сводка задач и важных событий за вчера.',
    group: 'digest',
  },
  {
    key: TELEGRAM_NOTIFICATION_KEYS.weeklyReport,
    label: 'Еженедельный отчёт',
    group: 'digest',
  },
  {
    key: TELEGRAM_NOTIFICATION_KEYS.taskNoDueDate,
    label: 'Новые задачи без срочного срока',
    group: 'team',
  },
  {
    key: TELEGRAM_NOTIFICATION_KEYS.teamDecisionsWithoutMe,
    label: 'Решения команды, в которых я не участвовал',
    group: 'team',
  },
];
