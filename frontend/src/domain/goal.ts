import type { ChartTone } from "@/ui/components/dashboard/charts/tones";

export type GoalStatus = "active" | "paused" | "achieved" | "abandoned";

export const GOAL_STATUS_VALUES: readonly GoalStatus[] = [
  "active",
  "paused",
  "achieved",
  "abandoned",
] as const;

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  active: "Активная",
  paused: "На паузе",
  achieved: "Достигнута",
  abandoned: "Архивирована",
};

const KNOWN_STATUSES: ReadonlySet<string> = new Set(GOAL_STATUS_VALUES);

function parseStatus(raw: string): GoalStatus {
  return KNOWN_STATUSES.has(raw) ? (raw as GoalStatus) : "active";
}

export type GoalThemeSource = "manual" | "ai";

export const GOAL_THEME_SOURCE_LABELS: Record<GoalThemeSource, string> = {
  manual: "Вручную",
  ai: "AI",
};

function parseThemeSource(raw: string): GoalThemeSource {
  return raw === "ai" ? "ai" : "manual";
}

export type GoalSource = "manual" | "ai";

function parseGoalSource(raw: string): GoalSource {
  return raw === "ai" ? "ai" : "manual";
}

export function goalSourceLabel(source: GoalSource): string {
  return source === "ai" ? "Предложено Корой" : "Создано вручную";
}

export type GoalPromotionState = "suggested" | "active" | "dismissed";

const KNOWN_PROMOTION_STATES: ReadonlySet<string> = new Set([
  "suggested",
  "active",
  "dismissed",
]);

function parsePromotionState(raw: string): GoalPromotionState {
  return KNOWN_PROMOTION_STATES.has(raw)
    ? (raw as GoalPromotionState)
    : "active";
}

export const GOAL_PROMOTION_STATE_LABELS: Record<GoalPromotionState, string> = {
  suggested: "Предложено Корой",
  active: "Активная",
  dismissed: "Отклонена",
};

export type GoalProgressStatus =
  | "on_track"
  | "at_risk"
  | "stalled"
  | "achieved"
  | "dropped";

const KNOWN_PROGRESS_STATUSES: ReadonlySet<string> = new Set([
  "on_track",
  "at_risk",
  "stalled",
  "achieved",
  "dropped",
]);

function parseProgressStatus(raw: string): GoalProgressStatus {
  return KNOWN_PROGRESS_STATUSES.has(raw)
    ? (raw as GoalProgressStatus)
    : "on_track";
}

export const GOAL_PROGRESS_STATUS_LABELS: Record<GoalProgressStatus, string> = {
  on_track: "В движении",
  at_risk: "Под риском",
  stalled: "Застряла",
  achieved: "Достигнута",
  dropped: "Выпала",
};

export function progressStatusChipClasses(status: GoalProgressStatus): {
  bg: string;
  fg: string;
} {
  switch (status) {
    case "on_track":
      return { bg: "bg-chip-success-bg", fg: "text-chip-success-fg" };
    case "at_risk":
      return { bg: "bg-chip-warning-bg", fg: "text-chip-warning-fg" };
    case "stalled":
      return { bg: "bg-chip-danger-bg", fg: "text-chip-danger-fg" };
    case "achieved":
      return { bg: "bg-chip-info-bg", fg: "text-chip-info-fg" };
    case "dropped":
      return { bg: "bg-chip-sand-bg", fg: "text-chip-sand-fg" };
  }
}

export function progressStatusTone(status: GoalProgressStatus): ChartTone {
  switch (status) {
    case "on_track":
      return "success";
    case "at_risk":
      return "warning";
    case "stalled":
      return "danger";
    case "achieved":
      return "accent";
    case "dropped":
      return "neutral";
  }
}

export type GoalHorizon =
  | "strategic"
  | "annual"
  | "quarterly"
  | "monthly"
  | "sprint";

export const GOAL_HORIZON_VALUES: readonly GoalHorizon[] = [
  "strategic",
  "annual",
  "quarterly",
  "monthly",
  "sprint",
] as const;

export const GOAL_HORIZON_LABELS: Record<GoalHorizon, string> = {
  strategic: "Стратегический",
  annual: "Годовой",
  quarterly: "Квартальный",
  monthly: "Месячный",
  sprint: "Спринт",
};

export type GoalKrSourceKind =
  | "manual"
  | "meeting_count"
  | "issue_rollup"
  | "metric_entity";

export const GOAL_KR_SOURCE_KIND_VALUES: readonly GoalKrSourceKind[] = [
  "manual",
  "meeting_count",
  "issue_rollup",
  "metric_entity",
] as const;

export const GOAL_KR_SOURCE_KIND_LABELS: Record<GoalKrSourceKind, string> = {
  manual: "Вручную",
  meeting_count: "Число встреч",
  issue_rollup: "Из задач",
  metric_entity: "Из метрики графа",
};

function parseKrSourceKind(raw: string): GoalKrSourceKind {
  switch (raw) {
    case "meeting_count":
    case "issue_rollup":
    case "metric_entity":
      return raw;
    default:
      return "manual";
  }
}

export type GoalThemeLinkApi = {
  themeId: string;
  themeName: string;
  source: "manual" | "ai";
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

export type GoalKeyResultApi = {
  id: string;
  goalId: string;
  name: string;
  unit: string | null;
  startValue: number;
  targetValue: number;
  currentValue: number;
  progressPercent: number;
  sourceKind: "manual" | "meeting_count" | "issue_rollup" | "metric_entity";
  source: "manual" | "ai";
  manualOverride: string[];
  createdAt: string;
  updatedAt: string;
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
  source: "manual" | "ai";
  promotionState: "suggested" | "active" | "dismissed";
  progressStatus: "on_track" | "at_risk" | "stalled" | "achieved" | "dropped";
  parentGoalId: string | null;
  ownerPersonId: string | null;
  ownerPersonName: string | null;
  blocksCount: number | null;
};

export type GoalDetailApi = GoalListItemApi & {
  themes: GoalThemeLinkApi[];
  latestSnapshot: GoalAlignmentSnapshotApi | null;
  timeline: GoalAlignmentSnapshotApi[];
  confidence: number | null;
  keyResults: GoalKeyResultApi[];
};

export type GoalListApi = {
  items: GoalListItemApi[];
  total: number;
};

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

export type GoalKeyResultDomain = {
  id: string;
  goalId: string;
  name: string;
  unit: string | null;
  startValue: number;
  targetValue: number;
  currentValue: number;
  progressPercent: number;
  sourceKind: GoalKrSourceKind;
  source: GoalSource;
  manualOverride: string[];
  createdAt: Date;
  updatedAt: Date;
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
  source: GoalSource;
  promotionState: GoalPromotionState;
  progressStatus: GoalProgressStatus;
  parentGoalId: string | null;
  ownerPersonId: string | null;
  ownerPersonName: string | null;
  blocksCount: number | null;
};

export type GoalDetailDomain = GoalDomain & {
  themes: GoalThemeLinkDomain[];
  latestSnapshot: GoalAlignmentSnapshotDomain | null;
  timeline: GoalAlignmentSnapshotDomain[];
  confidence: number | null;
  keyResults: GoalKeyResultDomain[];
};

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

export function goalKeyResultFromApi(
  api: GoalKeyResultApi,
): GoalKeyResultDomain {
  return {
    id: api.id,
    goalId: api.goalId,
    name: api.name,
    unit: api.unit,
    startValue: api.startValue,
    targetValue: api.targetValue,
    currentValue: api.currentValue,
    progressPercent: api.progressPercent,
    sourceKind: parseKrSourceKind(api.sourceKind),
    source: parseGoalSource(api.source),
    manualOverride: Array.isArray(api.manualOverride) ? api.manualOverride : [],
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
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
    source: parseGoalSource(api.source),
    promotionState: parsePromotionState(api.promotionState),
    progressStatus: parseProgressStatus(api.progressStatus),
    parentGoalId: api.parentGoalId,
    ownerPersonId: api.ownerPersonId ?? null,
    ownerPersonName: api.ownerPersonName ?? null,
    blocksCount: api.blocksCount ?? null,
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
    confidence: api.confidence,
    keyResults: Array.isArray(api.keyResults)
      ? api.keyResults.map(goalKeyResultFromApi)
      : [],
  };
}

export function alignmentTextColor(score: number | null): string {
  if (score === null) return "text-fg-tertiary";
  if (score < 40) return "text-danger";
  if (score < 70) return "text-warning";
  return "text-success";
}

export function alignmentBarColor(score: number | null): string {
  if (score === null) return "bg-fg-tertiary";
  if (score < 40) return "bg-danger";
  if (score < 70) return "bg-warning";
  return "bg-success";
}

export type ConfidenceLevel = "low" | "medium" | "high";

export const CONFIDENCE_LEVEL_LABELS: Record<ConfidenceLevel, string> = {
  low: "Мало данных",
  medium: "Достаточно данных",
  high: "Много данных",
};

export function confidenceLevel(
  themesCount: number,
  blocksCount: number | null,
): ConfidenceLevel {
  if (themesCount === 0) return "low";
  const blocks = blocksCount ?? themesCount * 5;
  if (themesCount >= 3 && blocks >= 20) return "high";
  if (blocks < 5) return "low";
  return "medium";
}

export function confidenceChipClasses(level: ConfidenceLevel): {
  bg: string;
  fg: string;
} {
  switch (level) {
    case "low":
      return { bg: "bg-chip-danger-bg", fg: "text-chip-danger-fg" };
    case "medium":
      return { bg: "bg-chip-warning-bg", fg: "text-chip-warning-fg" };
    case "high":
      return { bg: "bg-chip-success-bg", fg: "text-chip-success-fg" };
  }
}

export type MovementVerdict = {
  label: string;
  tone: "success" | "warning" | "danger" | "neutral";
};

export function movementVerdict(
  alignment: number | null,
  progress: GoalProgressStatus,
): MovementVerdict {
  switch (progress) {
    case "achieved":
      return { label: "Достигнута", tone: "success" };
    case "dropped":
      return { label: "Выпала из работы", tone: "neutral" };
    case "stalled":
      return { label: "Застряла", tone: "danger" };
    case "at_risk":
      return { label: "Под риском", tone: "warning" };
    case "on_track": {
      if (alignment !== null && alignment >= 70)
        return { label: "Уверенно движемся", tone: "success" };
      if (alignment !== null && alignment >= 40)
        return { label: "Движемся", tone: "success" };
      return { label: "Движемся, но согласованность низкая", tone: "warning" };
    }
  }
}

export function movementVerdictChipClasses(tone: MovementVerdict["tone"]): {
  bg: string;
  fg: string;
} {
  switch (tone) {
    case "success":
      return { bg: "bg-chip-success-bg", fg: "text-chip-success-fg" };
    case "warning":
      return { bg: "bg-chip-warning-bg", fg: "text-chip-warning-fg" };
    case "danger":
      return { bg: "bg-chip-danger-bg", fg: "text-chip-danger-fg" };
    case "neutral":
      return { bg: "bg-bg-overlay", fg: "text-fg-secondary" };
  }
}

export function krProgressBarColor(progressPercent: number): string {
  const clamped = Math.max(0, Math.min(100, progressPercent));
  return clamped >= 100 ? "bg-success" : "bg-info";
}

export function formatAlignment(score: number | null): string {
  if (score === null) return "—";
  return String(Math.max(0, Math.min(100, Math.round(score))));
}

export function formatDelta(delta: number | null): string | null {
  if (delta === null) return null;
  if (delta === 0) return "0";
  return delta > 0 ? `+${delta}` : String(delta);
}

export function deltaTone(delta: number | null): "up" | "down" | "flat" | null {
  if (delta === null) return null;
  if (delta > 0) return "up";
  if (delta < 0) return "down";
  return "flat";
}

export function daysUntil(targetDate: Date | null): number | null {
  if (!targetDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(targetDate);
  target.setHours(0, 0, 0, 0);
  const diffMs = target.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

export function targetDateLabel(targetDate: Date | null): string | null {
  const days = daysUntil(targetDate);
  if (days === null) return null;
  if (days === 0) return "Сегодня";
  if (days < 0) return `Просрочена на ${Math.abs(days)} дн.`;
  return `Осталось ${days} дн.`;
}

export type GoalTreeRenderNode = {
  id: string;
  name: string;
  progressStatus: GoalProgressStatus;
  keyResults?: Array<{
    id: string;
    name: string;
    progressPercent: number;
    unit: string | null;
  }>;
  children: GoalTreeRenderNode[];
};

export function buildTree(goals: readonly GoalDomain[]): GoalTreeRenderNode[] {
  const byId = new Map<string, GoalTreeRenderNode>();
  for (const g of goals) {
    byId.set(g.id, {
      id: g.id,
      name: g.name,
      progressStatus: g.progressStatus,
      children: [],
    });
  }

  const roots: GoalTreeRenderNode[] = [];
  for (const g of goals) {
    const node = byId.get(g.id)!;
    const parent =
      g.parentGoalId !== null ? byId.get(g.parentGoalId) : undefined;
    if (parent && parent !== node) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export function statusBadgeVariant(
  status: GoalStatus,
): "default" | "success" | "secondary" | "warning" {
  switch (status) {
    case "active":
      return "default";
    case "paused":
      return "warning";
    case "achieved":
      return "success";
    case "abandoned":
      return "secondary";
  }
}
