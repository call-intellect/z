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
  PendingActionDetailApi,
  PendingActionItemApi,
  PendingActionSeverityApi,
  PendingActionSourceApi,
  PendingActionsCountApi,
} from '@/api/pending-actions.api';

export type PendingActionSource = PendingActionSourceApi;
export type PendingActionSeverity = PendingActionSeverityApi;

/** Ссылка на момент встречи (готовая к рендеру). */
export interface PendingActionCite {
  meetingTitle?: string;
  timecode?: string;
  url?: string;
}

/** Версия факта в конфликте. */
export interface ConflictVersion {
  text: string;
  date?: string;
  cite?: PendingActionCite;
}

/**
 * Доменный `detail` — дискриминированный union по `kind` (= source).
 * Confidence у intake нормализован в проценты 0..100 (число) либо undefined.
 */
export type PendingActionDetail =
  | {
      kind: 'probe';
      question: string;
      context?: string;
      meetingTitle?: string;
      cite?: PendingActionCite;
      notificationId: string;
    }
  | {
      kind: 'conflict';
      summary: string;
      oldVersion: ConflictVersion;
      newVersion: ConflictVersion;
    }
  | {
      kind: 'intake';
      title: string;
      description?: string;
      assigneeName?: string;
      dueLabel?: string;
      /** Уверенность Коры в процентах 0..100. */
      confidencePct?: number;
      cite?: PendingActionCite;
    }
  | {
      kind: 'curation';
      cardTitle: string;
      preview?: string;
      cite?: PendingActionCite;
    };

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
  /** Дискриминированная суть item'а для inline-резолва (опц.). */
  detail?: PendingActionDetail;
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

/** «ждёт N дн.» / «ждёт сегодня» — подпись возраста для чипа в группах (Ф4). */
export function formatPendingWait(ageDays: number): string {
  const d = Math.max(0, Math.round(ageDays));
  return d === 0 ? 'ждёт сегодня' : `ждёт ${d} дн.`;
}

/**
 * RU-лейбл приоритета по severity (для чипа внутри группы). `urgent` →
 * «высокий приоритет», `normal` → «средний приоритет».
 */
export function formatPendingPriority(severity: PendingActionSeverity): string {
  return severity === 'urgent' ? 'высокий приоритет' : 'средний приоритет';
}

/**
 * Готовая подпись cite: «встреча <title> [таймкод]» — используется в чипе
 * источника. Возвращает null, если рисовать нечего.
 */
export function formatPendingCite(cite?: PendingActionCite): string | null {
  if (!cite) return null;
  const parts: string[] = [];
  if (cite.meetingTitle) parts.push(`встреча ${cite.meetingTitle}`);
  if (cite.timecode) parts.push(`[${cite.timecode}]`);
  const text = parts.join(' ').trim();
  return text.length > 0 ? text : null;
}

// ─── mappers ────────────────────────────────────────────────────────

/** Нормализуем confidence (0..1 ИЛИ 0..100) в целые проценты 0..100. */
function normalizeConfidencePct(raw?: number): number | undefined {
  if (raw == null || Number.isNaN(raw)) return undefined;
  const pct = raw <= 1 ? raw * 100 : raw;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

function mapCite(
  cite?: PendingActionCite | undefined,
): PendingActionCite | undefined {
  if (!cite) return undefined;
  return {
    meetingTitle: cite.meetingTitle,
    timecode: cite.timecode,
    url: cite.url,
  };
}

export function mapPendingActionDetail(
  api: PendingActionDetailApi | undefined,
): PendingActionDetail | undefined {
  if (!api) return undefined;
  switch (api.kind) {
    case 'probe':
      return {
        kind: 'probe',
        question: api.question,
        context: api.context,
        meetingTitle: api.meetingTitle,
        cite: mapCite(api.cite),
        notificationId: api.notificationId,
      };
    case 'conflict':
      return {
        kind: 'conflict',
        summary: api.summary,
        oldVersion: {
          text: api.oldVersion.text,
          date: api.oldVersion.date,
          cite: mapCite(api.oldVersion.cite),
        },
        newVersion: {
          text: api.newVersion.text,
          date: api.newVersion.date,
          cite: mapCite(api.newVersion.cite),
        },
      };
    case 'intake':
      return {
        kind: 'intake',
        title: api.title,
        description: api.description,
        assigneeName: api.assigneeName,
        dueLabel: api.dueLabel,
        confidencePct: normalizeConfidencePct(api.confidence),
        cite: mapCite(api.cite),
      };
    case 'curation':
      return {
        kind: 'curation',
        cardTitle: api.cardTitle,
        preview: api.preview,
        cite: mapCite(api.cite),
      };
    default:
      return undefined;
  }
}

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
    detail: mapPendingActionDetail(api.detail),
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
