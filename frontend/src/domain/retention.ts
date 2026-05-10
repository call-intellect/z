/**
 * Доменная модель `OrgRetentionPolicy` (Фаза 11 knowledge-core / 152-ФЗ).
 *
 * Контракт API: `backend/src/modules/retention/retention-policy.controller.ts`.
 *
 * Слои данных (frontend-rules):
 *   - `OrgRetentionPolicyApi`  — сырое DTO с бэкенда (lastSweepAt/updatedAt = ISO).
 *   - `OrgRetentionPolicyDomain` — даты как `Date`, остальное без изменений.
 */

export const ARCHIVED_BLOCK_ACTIONS = [
  'archive_then_delete',
  'keep_forever',
] as const;

export type ArchivedBlockAction = (typeof ARCHIVED_BLOCK_ACTIONS)[number];

export interface OrgRetentionPolicyApi {
  tenantId: string;
  rawEventDays: number;
  archivedBlockDays: number;
  chatMessageDays: number;
  auditLogDays: number;
  archivedBlockAction: ArchivedBlockAction | string;
  lastSweepAt: string | null;
  updatedAt: string;
}

export interface OrgRetentionPolicyDomain {
  tenantId: string;
  rawEventDays: number;
  archivedBlockDays: number;
  chatMessageDays: number;
  auditLogDays: number;
  archivedBlockAction: ArchivedBlockAction;
  lastSweepAt: Date | null;
  updatedAt: Date;
}

export interface UpdateRetentionPolicyRequest {
  rawEventDays?: number;
  archivedBlockDays?: number;
  chatMessageDays?: number;
  auditLogDays?: number;
  archivedBlockAction?: ArchivedBlockAction;
}

export function retentionPolicyFromApi(
  dto: OrgRetentionPolicyApi,
): OrgRetentionPolicyDomain {
  return {
    tenantId: dto.tenantId,
    rawEventDays: dto.rawEventDays,
    archivedBlockDays: dto.archivedBlockDays,
    chatMessageDays: dto.chatMessageDays,
    auditLogDays: dto.auditLogDays,
    archivedBlockAction: normalizeAction(dto.archivedBlockAction),
    lastSweepAt: dto.lastSweepAt ? new Date(dto.lastSweepAt) : null,
    updatedAt: new Date(dto.updatedAt),
  };
}

function normalizeAction(value: string): ArchivedBlockAction {
  return (ARCHIVED_BLOCK_ACTIONS as readonly string[]).includes(value)
    ? (value as ArchivedBlockAction)
    : 'archive_then_delete';
}

export const archivedBlockActionLabel: Record<ArchivedBlockAction, string> = {
  archive_then_delete: 'Архивировать, затем удалить',
  keep_forever: 'Хранить вечно',
};

export const archivedBlockActionHint: Record<ArchivedBlockAction, string> = {
  archive_then_delete:
    'Через N дней после архивации блок будет удалён без возможности восстановления.',
  keep_forever:
    'Архивные блоки никогда не удаляются автоматически. Подходит для compliance.',
};

/** Минимальные значения по полям политики (соответствуют backend zod-схеме). */
export const RETENTION_LIMITS = {
  rawEventDays: { min: 30, max: 36500 },
  archivedBlockDays: { min: 1, max: 36500 },
  chatMessageDays: { min: 7, max: 36500 },
  auditLogDays: { min: 1, max: 36500 },
} as const;
