import type {
  ChannelEntryApi,
  ChannelKindApi,
  NotificationApi,
  NotificationDetailApi,
  NotificationDeliveryApi,
  NotificationResponseStatusApi,
  NotificationStatusApi,
} from '@/api/conversational.api';

/**
 * Domain-модели conversational-слоя. Содержат человекочитаемые
 * русские лейблы (UI-сборка), даты как `Date`, и собранные «удобные»
 * флаги для рендера.
 */

export type ChannelKind = ChannelKindApi;

const CHANNEL_KIND_LABELS: Record<ChannelKind, string> = {
  in_app: 'В личном кабинете',
  email_smtp: 'Email',
  email_imap: 'Email (входящие)',
  telegram_bot: 'Telegram',
  max_bot: 'MAX',
};

export function channelKindLabel(kind: ChannelKind): string {
  return CHANNEL_KIND_LABELS[kind] ?? kind;
}

export type ChannelEntry = {
  channelId: string;
  kind: ChannelKind;
  label: string;
  direction: 'inbound_only' | 'outbound_only' | 'bidirectional';
  status: 'active' | 'disabled' | 'broken';
  maxDataClass: 'public' | 'internal' | 'sensitive' | 'private';
  binding: {
    id: string;
    externalId: string;
    verifiedAt: Date | null;
    preferences: Record<string, unknown>;
    /** W4.3 — per-binding потолок чувствительности (radio в /me/channels). */
    maxDataClass: 'public' | 'internal' | 'sensitive' | 'private';
  } | null;
};

export function mapChannelEntry(api: ChannelEntryApi): ChannelEntry {
  return {
    channelId: api.channel.id,
    kind: api.channel.kind,
    label: channelKindLabel(api.channel.kind),
    direction: api.channel.direction,
    status: api.channel.status,
    maxDataClass: api.channel.maxDataClass,
    binding: api.binding
      ? {
          id: api.binding.id,
          externalId: api.binding.externalId,
          verifiedAt: api.binding.verifiedAt
            ? new Date(api.binding.verifiedAt)
            : null,
          preferences: (api.binding.preferences ?? {}) as Record<string, unknown>,
          maxDataClass: api.binding.maxDataClass ?? 'internal',
        }
      : null,
  };
}

// ──────────────────────── Notification ────────────────────────

export type NotificationStatus = NotificationStatusApi;
export type NotificationResponseStatus = NotificationResponseStatusApi;

const STATUS_LABELS: Record<NotificationStatus, string> = {
  queued: 'В очереди',
  sent_partial: 'Частично доставлено',
  delivered: 'Доставлено',
  read: 'Прочитано',
  responded: 'Отвечено',
  failed: 'Не доставлено',
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  // Источник кодов — backend conversational.service.ts (per-event policy map).
  'probe.question': 'Уточняющий вопрос',
  'probe.digest': 'Вопросы от Коры',
  'probe.answer_acknowledged': 'Ответ записан',
  'specialist.probe': 'Подсказка специалиста',
  'proactive.notification': 'Подсказка Коры',
  'curation.pending': 'Нужна модерация',
  'system.message': 'Системное сообщение',
  'idea.status_changed': 'Изменён статус идеи',
  'operations.weekly_digest': 'Сводка за неделю',
  'operations.monthly_recap': 'Итоги месяца',
  'goals.pulse': 'Пульс целей',
  'issue.mention': 'Упоминание в задаче',
  'event.reminder': 'Напоминание о событии',
  'checkin.prompt': 'Время чек-ина',
  'checkin.ack': 'Чек-ин принят',
  'actions.reminder': 'Напоминание о подтверждениях',
  'meeting.invite': 'Приглашение на встречу',
  'support.ticket_created': 'Новое обращение в поддержку',
  'support.ticket_reply': 'Ответ поддержки',
  'chat.answer': 'Ответ ассистента',
};

export function notificationStatusLabel(s: NotificationStatus): string {
  return STATUS_LABELS[s] ?? s;
}

export function eventTypeLabel(eventType: string): string {
  return EVENT_TYPE_LABELS[eventType] ?? eventType;
}

export type Notification = {
  id: string;
  eventType: string;
  eventTypeLabel: string;
  payload: Record<string, unknown>;
  dataClass: 'public' | 'internal' | 'sensitive' | 'private';
  contextBlockId: string | null;
  contextCardId: string | null;
  status: NotificationStatus;
  statusLabel: string;
  responseStatus: NotificationResponseStatus;
  responsePayload: Record<string, unknown> | null;
  expiresAt: Date | null;
  createdAt: Date;
  respondedAt: Date | null;
  /** Удобный флаг: нужен ли ответ пользователя сейчас. */
  needsResponse: boolean;
};

export function mapNotification(api: NotificationApi): Notification {
  return {
    id: api.id,
    eventType: api.eventType,
    eventTypeLabel: eventTypeLabel(api.eventType),
    payload: (api.payload ?? {}) as Record<string, unknown>,
    dataClass: api.dataClass,
    contextBlockId: api.contextBlockId,
    contextCardId: api.contextCardId,
    status: api.status,
    statusLabel: notificationStatusLabel(api.status),
    responseStatus: api.responseStatus,
    responsePayload:
      api.responsePayload && typeof api.responsePayload === 'object'
        ? (api.responsePayload as Record<string, unknown>)
        : null,
    expiresAt: api.expiresAt ? new Date(api.expiresAt) : null,
    createdAt: new Date(api.createdAt),
    respondedAt: api.respondedAt ? new Date(api.respondedAt) : null,
    needsResponse: api.responseStatus === 'pending',
  };
}

export type NotificationDelivery = {
  id: string;
  channelBindingId: string;
  status: string;
  attempts: number;
  attemptedAt: Date;
  deliveredAt: Date | null;
  readAt: Date | null;
  respondedAt: Date | null;
  errorReason: string | null;
};

export function mapDelivery(api: NotificationDeliveryApi): NotificationDelivery {
  return {
    id: api.id,
    channelBindingId: api.channelBindingId,
    status: api.status,
    attempts: api.attempts,
    attemptedAt: new Date(api.attemptedAt),
    deliveredAt: api.deliveredAt ? new Date(api.deliveredAt) : null,
    readAt: api.readAt ? new Date(api.readAt) : null,
    respondedAt: api.respondedAt ? new Date(api.respondedAt) : null,
    errorReason: api.errorReason,
  };
}

export type NotificationDetail = Notification & {
  deliveries: NotificationDelivery[];
};

export function mapNotificationDetail(api: NotificationDetailApi): NotificationDetail {
  return {
    ...mapNotification(api),
    deliveries: api.deliveries.map(mapDelivery),
  };
}
