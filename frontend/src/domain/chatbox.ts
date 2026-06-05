/**
 * DomainModel + мапперы для интеграции с Чат боксом
 * (ТЗ 2026-06-05 chatbox-integration, Фаза 7).
 *
 * Слой ApiDto → DomainModel → UiModel (см. правило `frontend-rules`).
 * Здесь: parse ISO-строк в Date, человекочитаемые русские лейблы статуса
 * и режима синхронизации.
 */

import type {
  ChatboxChatApi,
  ChatboxChatDetailApi,
  ChatboxChatStatusApi,
  ChatboxIntegrationApi,
  ChatboxLinkMode,
  ChatboxMemberApi,
  ChatboxMessageApi,
  ChatboxSenderTypeApi,
  ChatboxSessionApi,
  ChatboxStatus,
  ChatboxSyncMode,
  MessengerIdentityApi,
} from '@/api/chatbox.api';

const STATUS_LABELS: Record<ChatboxStatus, string> = {
  connected: 'Подключено',
  error: 'Ошибка',
  disconnected: 'Отключено',
};

const SYNC_MODE_LABELS: Record<ChatboxSyncMode, string> = {
  hourly: 'Раз в час',
  daily: 'Раз в сутки',
  realtime: 'При новом сообщении',
};

export function chatboxStatusLabel(status: ChatboxStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function chatboxSyncModeLabel(mode: ChatboxSyncMode): string {
  return SYNC_MODE_LABELS[mode] ?? mode;
}

/** Все режимы синхронизации для выпадающего списка. */
export const CHATBOX_SYNC_MODES: ReadonlyArray<{
  value: ChatboxSyncMode;
  label: string;
}> = [
  { value: 'hourly', label: SYNC_MODE_LABELS.hourly },
  { value: 'daily', label: SYNC_MODE_LABELS.daily },
  { value: 'realtime', label: SYNC_MODE_LABELS.realtime },
];

export type ChatboxIntegrationView = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  syncMode: ChatboxSyncMode;
  syncModeLabel: string;
  status: ChatboxStatus;
  statusLabel: string;
  lastError: string | null;
  lastFullSyncAt: Date | null;
  lastIncrementalSyncAt: Date | null;
  hasToken: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
};

function toDate(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function mapIntegration(
  api: ChatboxIntegrationApi | null,
): ChatboxIntegrationView | null {
  if (!api) return null;
  return {
    id: api.id,
    workspaceId: api.workspaceId,
    workspaceName: api.workspaceName,
    syncMode: api.syncMode,
    syncModeLabel: chatboxSyncModeLabel(api.syncMode),
    status: api.status,
    statusLabel: chatboxStatusLabel(api.status),
    lastError: api.lastError ?? null,
    lastFullSyncAt: toDate(api.lastFullSyncAt),
    lastIncrementalSyncAt: toDate(api.lastIncrementalSyncAt),
    hasToken: api.hasToken,
    createdAt: toDate(api.createdAt),
    updatedAt: toDate(api.updatedAt),
  };
}

// --- Просмотр чатов (ТЗ 2026-06-05 chatbox-integration, Фаза 8) ---

/**
 * Человекочитаемое имя мессенджера по техническому `channelType`.
 * Чат бокс присылает разные варианты одного канала (например
 * `TELEGRAM` и `TELEGRAM_PRIVATE`) — схлопываем их в один лейбл.
 */
export function chatboxChannelTypeLabel(type: string): string {
  switch (type) {
    case 'TELEGRAM':
    case 'TELEGRAM_PRIVATE':
      return 'Telegram';
    case 'WHATSAPP':
    case 'WHATSAPP_BUSINESS':
    case 'WHATSAPP_WHAPI':
    case 'EXT_WHATSAPP':
      return 'WhatsApp';
    case 'MAX':
    case 'EXT_MAX':
      return 'MAX';
    case 'CHAT_WIDGET':
      return 'Виджет';
    case 'AVITO':
      return 'Avito';
    case 'VK':
      return 'VK';
    case 'CIAN':
      return 'Циан';
    case 'EMAIL_CLIENT':
      return 'Email';
    default:
      return 'Другое';
  }
}

/**
 * Пара токен-классов для бейджа мессенджера. Только дизайн-токены,
 * без hex/text-white.
 */
export function chatboxChannelTypeBadgeClass(type: string): string {
  const label = chatboxChannelTypeLabel(type);
  switch (label) {
    case 'Telegram':
      return 'bg-info/10 text-info';
    case 'WhatsApp':
      return 'bg-success/10 text-success';
    case 'MAX':
      return 'bg-accent-muted text-accent-fg';
    default:
      return 'bg-bg-subtle text-fg-secondary';
  }
}

const CHAT_STATUS_LABELS: Record<ChatboxChatStatusApi, string> = {
  active: 'Активен',
  closed: 'Закрыт',
};

export function chatboxChatStatusLabel(status: ChatboxChatStatusApi): string {
  return CHAT_STATUS_LABELS[status] ?? status;
}

const ANALYSIS_STATUS_LABELS: Record<string, string> = {
  pending: 'В очереди',
  analyzing: 'Анализ',
  done: 'Готово',
  failed: 'Ошибка',
};

export function chatboxAnalysisStatusLabel(status: string): string {
  return ANALYSIS_STATUS_LABELS[status] ?? status;
}

/** Роль отправителя сообщения: клиент слева, менеджер/бот справа. */
export type ChatboxSenderRole = 'client' | 'manager';

export function senderRoleOf(type: ChatboxSenderTypeApi): ChatboxSenderRole {
  return type === 'CLIENT' ? 'client' : 'manager';
}

export type MessengerIdentityView = {
  channelType: string;
  channelLabel: string;
  externalId: string;
  name: string;
  avatarUrl: string | null;
};

export type ChatboxChatView = {
  id: string;
  externalId: string;
  channelType: string;
  channelLabel: string;
  status: ChatboxChatStatusApi;
  statusLabel: string;
  clientName: string;
  responsibleName: string | null;
  customerExternalId: string | null;
  responsibleExternalId: string | null;
  lastMessageAt: Date | null;
  messageCount: number;
  externalCreatedAt: Date | null;
};

export type ChatboxSessionView = {
  id: string;
  seq: number;
  startedAt: Date | null;
  endedAt: Date | null;
  summary: string | null;
  analysisStatus: string;
  analysisStatusLabel: string;
  previousSessionId: string | null;
};

export type ChatboxChatDetailView = ChatboxChatView & {
  externalUpdatedAt: Date | null;
  sessions: ChatboxSessionView[];
  messengerIdentities: MessengerIdentityView[];
};

export type ChatboxMessageView = {
  id: string;
  senderType: ChatboxSenderTypeApi;
  senderRole: ChatboxSenderRole;
  senderName: string;
  contentType: ChatboxMessageApi['contentType'];
  text: string | null;
  imageUrl: string | null;
  fileUrl: string | null;
  audioUrl: string | null;
  videoUrl: string | null;
  externalCreatedAt: Date | null;
  isOutboundFromKora: boolean;
  sessionId: string | null;
};

function clientNameOf(api: ChatboxChatApi): string {
  return api.customer?.name ?? api.clientName ?? 'Без имени';
}

export function mapChat(api: ChatboxChatApi): ChatboxChatView {
  return {
    id: api.id,
    externalId: api.externalId,
    channelType: api.channelType,
    channelLabel: chatboxChannelTypeLabel(api.channelType),
    status: api.status,
    statusLabel: chatboxChatStatusLabel(api.status),
    clientName: clientNameOf(api),
    responsibleName: api.responsible?.name ?? null,
    customerExternalId: api.customer?.externalId ?? null,
    responsibleExternalId: api.responsible?.externalId ?? null,
    lastMessageAt: toDate(api.lastMessageAt),
    messageCount: api.messageCount,
    externalCreatedAt: toDate(api.externalCreatedAt),
  };
}

function mapSession(api: ChatboxSessionApi): ChatboxSessionView {
  return {
    id: api.id,
    seq: api.seq,
    startedAt: toDate(api.startedAt),
    endedAt: toDate(api.endedAt),
    summary: api.summary ?? null,
    analysisStatus: api.analysisStatus,
    analysisStatusLabel: chatboxAnalysisStatusLabel(api.analysisStatus),
    previousSessionId: api.previousSessionId ?? null,
  };
}

function mapMessengerIdentity(
  api: MessengerIdentityApi,
): MessengerIdentityView {
  return {
    channelType: api.channelType,
    channelLabel: chatboxChannelTypeLabel(api.channelType),
    externalId: api.externalId,
    name: api.name ?? api.externalId,
    avatarUrl: api.avatarUrl ?? null,
  };
}

export function mapChatDetail(
  api: ChatboxChatDetailApi,
): ChatboxChatDetailView {
  return {
    ...mapChat(api),
    externalUpdatedAt: toDate(api.externalUpdatedAt),
    sessions: (api.sessions ?? []).map(mapSession),
    messengerIdentities: (api.messengerIdentities ?? []).map(
      mapMessengerIdentity,
    ),
  };
}

// --- Менеджеры → сотрудники (ТЗ 2026-06-05 chatbox-integration, Фаза 9) ---

const LINK_MODE_LABELS: Record<ChatboxLinkMode, string> = {
  auto: 'Авто (по email)',
  manual: 'Вручную',
  none: 'Не связан',
};

export function chatboxLinkModeLabel(mode: ChatboxLinkMode): string {
  return LINK_MODE_LABELS[mode] ?? mode;
}

/**
 * Вариант бейджа режима связи (только дизайн-токены через shadcn Badge).
 * Палитра Badge: `default` использует accent-токены (auto), `success`
 * (вручную), `secondary` — приглушённый/нейтральный (не связан).
 */
export function chatboxLinkModeBadgeVariant(
  mode: ChatboxLinkMode,
): 'default' | 'success' | 'secondary' {
  switch (mode) {
    case 'auto':
      return 'default';
    case 'manual':
      return 'success';
    default:
      return 'secondary';
  }
}

export type ChatboxMemberView = {
  id: string;
  externalId: string;
  email: string | null;
  name: string | null;
  /** Имя для показа: name, иначе email, иначе externalId. */
  displayName: string;
  role: string | null;
  linkMode: ChatboxLinkMode;
  linkModeLabel: string;
  linkedPersonId: string | null;
  linkedPersonName: string | null;
};

export function mapMember(api: ChatboxMemberApi): ChatboxMemberView {
  return {
    id: api.id,
    externalId: api.externalId,
    email: api.email,
    name: api.name,
    displayName: api.name ?? api.email ?? api.externalId,
    role: api.role,
    linkMode: api.linkMode,
    linkModeLabel: chatboxLinkModeLabel(api.linkMode),
    linkedPersonId: api.linkedPerson?.id ?? null,
    linkedPersonName: api.linkedPerson?.name ?? null,
  };
}

export function mapMessage(api: ChatboxMessageApi): ChatboxMessageView {
  return {
    id: api.id,
    senderType: api.senderType,
    senderRole: senderRoleOf(api.senderType),
    senderName: api.senderName ?? '',
    contentType: api.contentType,
    text: api.text ?? null,
    imageUrl: api.imageUrl ?? null,
    fileUrl: api.fileUrl ?? null,
    audioUrl: api.audioUrl ?? null,
    videoUrl: api.videoUrl ?? null,
    externalCreatedAt: toDate(api.externalCreatedAt),
    isOutboundFromKora: api.isOutboundFromKora,
    sessionId: api.sessionId ?? null,
  };
}
