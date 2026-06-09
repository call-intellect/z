import type {
  BitrixIntegrationApi,
  BitrixIntegrationStatus,
} from '@/api/bitrix.api';

/**
 * Domain-слой Bitrix24-интеграции (ApiDto → DomainModel).
 * Гуманизирует статус и парсит даты.
 */

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
  pending: 'Ожидает привязки',
  connected: 'Подключено',
  error: 'Ошибка',
  disconnected: 'Отключено',
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
