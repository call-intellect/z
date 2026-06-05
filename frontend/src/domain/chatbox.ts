/**
 * DomainModel + мапперы для интеграции с Чат боксом
 * (ТЗ 2026-06-05 chatbox-integration, Фаза 7).
 *
 * Слой ApiDto → DomainModel → UiModel (см. правило `frontend-rules`).
 * Здесь: parse ISO-строк в Date, человекочитаемые русские лейблы статуса
 * и режима синхронизации.
 */

import type {
  ChatboxIntegrationApi,
  ChatboxStatus,
  ChatboxSyncMode,
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
