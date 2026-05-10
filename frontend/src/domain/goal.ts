/**
 * Доменная модель Goal (knowledge-core, Фаза 9).
 *
 * Goal — цель компании. Создаётся `owner` Org вручную. Связь с `Theme` — M:M
 * (manual или AI). Раз в сутки worker `strategic-alignment.worker` обновляет
 * `cachedAlignment` (0..100) — это «движение к цели».
 *
 * Контракт: `backend/src/modules/goals/dto/goals.dto.ts`.
 */

// ─── Enums ──────────────────────────────────────────────────────────────────

export type GoalStatus = 'active' | 'paused' | 'achieved' | 'abandoned';

export const GOAL_STATUS_VALUES: readonly GoalStatus[] = [
  'active',
  'paused',
  'achieved',
  'abandoned',
] as const;

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  active: 'Активная',
  paused: 'На паузе',
  achieved: 'Достигнута',
  abandoned: 'Архивирована',
};

const KNOWN_STATUSES: ReadonlySet<string> = new Set(GOAL_STATUS_VALUES);

function parseStatus(raw: string): GoalStatus {
  return KNOWN_STATUSES.has(raw) ? (raw as GoalStatus) : 'active';
}

export type GoalThemeSource = 'manual' | 'ai';

export const GOAL_THEME_SOURCE_LABELS: Record<GoalThemeSource, string> = {
  manual: 'Вручную',
  ai: 'AI',
};

function parseThemeSource(raw: string): GoalThemeSource {
  return raw === 'ai' ? 'ai' : 'manual';
}

// ─── API DTO (зеркало backend) ──────────────────────────────────────────────

export type GoalThemeLinkApi = {
  themeId: string;
  themeName: string;
  source: 'manual' | 'ai';
  weight: number;
  createdAt: string;
};

export type GoalAlignmentSnapshotApi = {
  id: string;
  goalId: string;
  score: number;
  delta: number | null;
  explanation: string;
  signals: { pro: string[]; contra: string[] };
  windowDays: number;
  themesCount: number;
  blocksCount: number;
  alertPending: boolean;
  createdAt: string;
};

export type GoalListItemApi = {
  id: string;
  name: string;
  description: string;
  targetDate: string | null;
  status: string;
  weight: number;
  cachedAlignment: number | null;
  cachedAlignmentAt: string | null;
  cachedAlignmentDelta: number | null;
  themesCount: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GoalDetailApi = GoalListItemApi & {
  themes: GoalThemeLinkApi[];
  latestSnapshot: GoalAlignmentSnapshotApi | null;
  timeline: GoalAlignmentSnapshotApi[];
};

export type GoalListApi = {
  items: GoalListItemApi[];
  total: number;
};

// ─── Domain-модели ──────────────────────────────────────────────────────────

export type GoalThemeLinkDomain = {
  themeId: string;
  themeName: string;
  source: GoalThemeSource;
  weight: number;
  createdAt: Date;
};

export type GoalAlignmentSnapshotDomain = {
  id: string;
  goalId: string;
  score: number;
  delta: number | null;
  explanation: string;
  signals: { pro: string[]; contra: string[] };
  windowDays: number;
  themesCount: number;
  blocksCount: number;
  alertPending: boolean;
  createdAt: Date;
};

export type GoalDomain = {
  id: string;
  name: string;
  description: string;
  targetDate: Date | null;
  status: GoalStatus;
  weight: number;
  cachedAlignment: number | null;
  cachedAlignmentAt: Date | null;
  cachedAlignmentDelta: number | null;
  themesCount: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type GoalDetailDomain = GoalDomain & {
  themes: GoalThemeLinkDomain[];
  latestSnapshot: GoalAlignmentSnapshotDomain | null;
  timeline: GoalAlignmentSnapshotDomain[];
};

// ─── Mappers ────────────────────────────────────────────────────────────────

const parseDate = (s: string | null | undefined): Date | null =>
  s ? new Date(s) : null;

export function goalThemeLinkFromApi(
  api: GoalThemeLinkApi,
): GoalThemeLinkDomain {
  return {
    themeId: api.themeId,
    themeName: api.themeName,
    source: parseThemeSource(api.source),
    weight: api.weight,
    createdAt: new Date(api.createdAt),
  };
}

export function goalAlignmentSnapshotFromApi(
  api: GoalAlignmentSnapshotApi,
): GoalAlignmentSnapshotDomain {
  return {
    id: api.id,
    goalId: api.goalId,
    score: api.score,
    delta: api.delta,
    explanation: api.explanation,
    signals: {
      pro: Array.isArray(api.signals?.pro) ? api.signals.pro : [],
      contra: Array.isArray(api.signals?.contra) ? api.signals.contra : [],
    },
    windowDays: api.windowDays,
    themesCount: api.themesCount,
    blocksCount: api.blocksCount,
    alertPending: api.alertPending,
    createdAt: new Date(api.createdAt),
  };
}

export function goalFromApi(api: GoalListItemApi): GoalDomain {
  return {
    id: api.id,
    name: api.name,
    description: api.description,
    targetDate: parseDate(api.targetDate),
    status: parseStatus(api.status),
    weight: api.weight,
    cachedAlignment: api.cachedAlignment,
    cachedAlignmentAt: parseDate(api.cachedAlignmentAt),
    cachedAlignmentDelta: api.cachedAlignmentDelta,
    themesCount: api.themesCount,
    archivedAt: parseDate(api.archivedAt),
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
  };
}

export function goalDetailFromApi(api: GoalDetailApi): GoalDetailDomain {
  const base = goalFromApi(api);
  return {
    ...base,
    themes: api.themes.map(goalThemeLinkFromApi),
    latestSnapshot: api.latestSnapshot
      ? goalAlignmentSnapshotFromApi(api.latestSnapshot)
      : null,
    timeline: api.timeline.map(goalAlignmentSnapshotFromApi),
  };
}

// ─── UI helpers ─────────────────────────────────────────────────────────────

/** Цветовая шкала alignment по диапазонам (Tailwind text-* классы). */
export function alignmentTextColor(score: number | null): string {
  if (score === null) return 'text-fg-tertiary';
  if (score < 40) return 'text-danger';
  if (score < 70) return 'text-warning';
  return 'text-success';
}

/** Цветовая шкала alignment для прогресс-бара (Tailwind bg-* классы). */
export function alignmentBarColor(score: number | null): string {
  if (score === null) return 'bg-fg-tertiary';
  if (score < 40) return 'bg-danger';
  if (score < 70) return 'bg-warning';
  return 'bg-success';
}

/**
 * Форматирует число alignment 0..100 как `82` (без процента — UI добавит знак,
 * если нужен). Возвращает «—», если null.
 */
export function formatAlignment(score: number | null): string {
  if (score === null) return '—';
  return String(Math.max(0, Math.min(100, Math.round(score))));
}

/** Описание delta в формате `+5`, `-12`, или `0`. null → null. */
export function formatDelta(delta: number | null): string | null {
  if (delta === null) return null;
  if (delta === 0) return '0';
  return delta > 0 ? `+${delta}` : String(delta);
}

/** Цвет delta (для стрелки): зелёный вверх, красный вниз, нейтральный 0. */
export function deltaTone(delta: number | null): 'up' | 'down' | 'flat' | null {
  if (delta === null) return null;
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return 'flat';
}

/**
 * Дни до targetDate относительно сегодня (00:00). null если targetDate нет.
 * Отрицательное число — просрочена.
 */
export function daysUntil(targetDate: Date | null): number | null {
  if (!targetDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(targetDate);
  target.setHours(0, 0, 0, 0);
  const diffMs = target.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Текст «Осталось N дней» / «Просрочена N дней» / «Сегодня».
 * Возвращает null если targetDate не задан.
 */
export function targetDateLabel(targetDate: Date | null): string | null {
  const days = daysUntil(targetDate);
  if (days === null) return null;
  if (days === 0) return 'Сегодня';
  if (days < 0) return `Просрочена на ${Math.abs(days)} дн.`;
  return `Осталось ${days} дн.`;
}

/** Helper для статус-бэйджа: вариант shadcn по статусу. */
export function statusBadgeVariant(
  status: GoalStatus,
): 'default' | 'success' | 'secondary' | 'warning' {
  switch (status) {
    case 'active':
      return 'default';
    case 'paused':
      return 'warning';
    case 'achieved':
      return 'success';
    case 'abandoned':
      return 'secondary';
  }
}
