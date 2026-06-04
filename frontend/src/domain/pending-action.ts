/**
 * Доменная модель Action Center — pending-подтверждение пользователя
 * (Фаза B1 ТЗ Action Center).
 *
 * Контракт: `src/api/pending-actions.api.ts` (backend Фаза B0).
 *
 * Слои:
 *   - `*Api`   — что приходит с бэка.
 *   - `*` (домен) — UI-friendly: готовые RU-лейблы источников и тон severity
 *     через парные цветовые токены (никаких сырых hex / text-white).
 */

import type {
  PendingActionItemApi,
  PendingActionSeverityApi,
  PendingActionSourceApi,
  PendingActionsCountApi,
} from '@/api/pending-actions.api';

export type PendingActionSource = PendingActionSourceApi;
export type PendingActionSeverity = PendingActionSeverityApi;

/** Доменная карточка подтверждения. */
export interface PendingAction {
  source: PendingActionSource;
  resourceType: string;
  resourceId: string;
  title: string;
  severity: PendingActionSeverity;
  ageDays: number;
  actionUrl: string;
  canQuickConfirm: boolean;
  /** Готовый RU-лейбл источника (см. PENDING_SOURCE_LABEL). */
  sourceLabel: string;
}

export interface PendingActionsCount {
  total: number;
  bySource: {
    curation: number;
    conflict: number;
    intake: number;
    probe: number;
  };
}

/**
 * RU-лейблы источников. Без английских слов (memory:
 * feedback_admin_ui_russian_only).
 */
export const PENDING_SOURCE_LABEL: Record<PendingActionSource, string> = {
  curation: 'Карточка знания',
  conflict: 'Конфликт',
  intake: 'Задача из встречи',
  probe: 'Вопрос Коры',
};

/**
 * Чип-вариант источника (парные токены chip-*). Используется для цветовой
 * маркировки источника в списках и поповере.
 */
export type PendingChipVariant =
  | 'info'
  | 'danger'
  | 'lavender'
  | 'sand';

export const PENDING_SOURCE_CHIP: Record<
  PendingActionSource,
  PendingChipVariant
> = {
  curation: 'info',
  conflict: 'danger',
  intake: 'lavender',
  probe: 'sand',
};

/**
 * Тон severity через парные цветовые токены.
 *
 *   - `urgent` → danger-тон (`bg-danger/15` + `text-danger`),
 *   - `normal` → нейтральный/accent-тон (`bg-accent-muted` + `text-accent`).
 *
 * Возвращаем готовый className-набор парных токенов — никогда не `text-white`
 * и не жёсткие hex (memory: feedback_paired_color_tokens).
 */
export function pendingSeverityToneClass(
  severity: PendingActionSeverity,
): string {
  return severity === 'urgent'
    ? 'bg-danger/15 text-danger border-danger/30'
    : 'bg-accent-muted text-accent border-accent-border';
}

/** Badge-variant для severity (shadcn Badge). */
export function pendingSeverityBadgeVariant(
  severity: PendingActionSeverity,
): 'danger' | 'secondary' {
  return severity === 'urgent' ? 'danger' : 'secondary';
}

/**
 * Идентичность item'а в feed'е = (source, resourceId). Используется для
 * оптимистичного удаления при snooze/confirm (B4) и для React-key.
 */
export function samePendingAction(
  a: { source: PendingActionSource; resourceId: string },
  b: { source: PendingActionSource; resourceId: string },
): boolean {
  return a.source === b.source && a.resourceId === b.resourceId;
}

/** «X дн.» — короткая подпись возраста карточки. */
export function formatPendingAge(ageDays: number): string {
  const d = Math.max(0, Math.round(ageDays));
  if (d === 0) return 'сегодня';
  return `${d} дн.`;
}

// ─── mappers ────────────────────────────────────────────────────────

export function mapPendingAction(api: PendingActionItemApi): PendingAction {
  return {
    source: api.source,
    resourceType: api.resourceType,
    resourceId: api.resourceId,
    title: api.title,
    severity: api.severity,
    ageDays: api.ageDays,
    actionUrl: api.actionUrl,
    canQuickConfirm: api.canQuickConfirm,
    sourceLabel: PENDING_SOURCE_LABEL[api.source] ?? api.source,
  };
}

export function mapPendingActionsCount(
  api: PendingActionsCountApi,
): PendingActionsCount {
  return {
    total: api.total,
    bySource: {
      curation: api.bySource?.curation ?? 0,
      conflict: api.bySource?.conflict ?? 0,
      intake: api.bySource?.intake ?? 0,
      probe: api.bySource?.probe ?? 0,
    },
  };
}
