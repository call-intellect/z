import type {
  BitrixIntegrationApi,
  BitrixIntegrationStatus,
  BitrixLinkMode,
  BitrixStatusApi,
  BitrixSyncScope,
} from "@/api/bitrix.api";

export interface BitrixIntegrationView {
  id: string;
  portalDomain: string;
  status: BitrixIntegrationStatus;
  statusLabel: string;
  scope: string | null;
  hasTokens: boolean;
  lastError: string | null;
  accessExpiresAt: Date | null;
  lastConnectedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

const STATUS_LABELS: Record<BitrixIntegrationStatus, string> = {
  pending: "Ожидает привязки",
  connected: "Подключено",
  error: "Ошибка",
  disconnected: "Отключено",
};

export function bitrixStatusLabel(status: BitrixIntegrationStatus): string {
  return STATUS_LABELS[status] ?? status;
}

function toDate(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function mapBitrixIntegration(
  api: BitrixIntegrationApi | null,
): BitrixIntegrationView | null {
  if (!api) return null;
  return {
    id: api.id,
    portalDomain: api.portalDomain,
    status: api.status,
    statusLabel: bitrixStatusLabel(api.status),
    scope: api.scope ?? null,
    hasTokens: api.hasTokens,
    lastError: api.lastError ?? null,
    accessExpiresAt: toDate(api.accessExpiresAt),
    lastConnectedAt: toDate(api.lastConnectedAt),
    createdAt: toDate(api.createdAt),
    updatedAt: toDate(api.updatedAt),
  };
}

export interface BitrixStatusView {
  integration: BitrixIntegrationView;
  analysisEnabled: boolean;
  runningScopes: BitrixSyncScope[];
  activeSyncScope: BitrixSyncScope | null;
  lastFullSyncAt: Date | null;
  lastIncrementalSyncAt: Date | null;
  counts: BitrixStatusApi["counts"];
  sessionsByStatus: BitrixStatusApi["sessionsByStatus"];
}

export function mapBitrixStatus(
  api: BitrixStatusApi | null,
): BitrixStatusView | null {
  if (!api) return null;
  return {
    integration: mapBitrixIntegration(api.integration)!,
    analysisEnabled: api.analysisEnabled,
    runningScopes: api.runningScopes ?? [],
    activeSyncScope: api.activeSyncScope ?? null,
    lastFullSyncAt: toDate(api.lastFullSyncAt),
    lastIncrementalSyncAt: toDate(api.lastIncrementalSyncAt),
    counts: api.counts,
    sessionsByStatus: api.sessionsByStatus,
  };
}

const LINK_MODE_LABELS: Record<BitrixLinkMode, string> = {
  none: "Не связан",
  auto: "Авто",
  manual: "Вручную",
};

export function bitrixLinkModeLabel(mode: BitrixLinkMode): string {
  return LINK_MODE_LABELS[mode] ?? mode;
}
