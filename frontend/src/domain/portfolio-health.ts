import type {
  PortfolioByPriorityApi,
  PortfolioByStatusApi,
  PortfolioHealthApi,
  PortfolioHealthLevelApi,
  PortfolioHealthRowApi,
  PortfolioPriorityKey,
  PortfolioProgressStatusKey,
} from "@/api/portfolio-health.api";
import { CHART } from "@/ui/components/dashboard/modern";

export const PORTFOLIO_PRIORITY_LABELS: Record<PortfolioPriorityKey, string> = {
  must: "Must (обязательно)",
  should: "Should (желательно)",
  could: "Could (можно)",
  wont: "Won't (не сейчас)",
  none: "Без приоритета",
};

export const PORTFOLIO_PRIORITY_ORDER: readonly PortfolioPriorityKey[] = [
  "must",
  "should",
  "could",
  "wont",
  "none",
] as const;

export const PORTFOLIO_PRIORITY_SELECTABLE: readonly (
  | "must"
  | "should"
  | "could"
  | "wont"
)[] = ["must", "should", "could", "wont"] as const;

export const PORTFOLIO_PROGRESS_LABELS: Record<
  PortfolioProgressStatusKey,
  string
> = {
  on_track: "в движении",
  at_risk: "под риском",
  stalled: "застряло",
  achieved: "достигнуто",
  dropped: "снято",
};

export function progressStatusLabel(raw: string): string {
  return (PORTFOLIO_PROGRESS_LABELS as Record<string, string>)[raw] ?? raw;
}

export function progressStatusPillTone(raw: string): "ok" | "warning" | "risk" {
  switch (raw) {
    case "achieved":
    case "on_track":
      return "ok";
    case "at_risk":
      return "warning";
    case "stalled":
    case "dropped":
    default:
      return "risk";
  }
}

export interface PortfolioHealthLevelView {
  label: string;
  color: string;
}

export function portfolioHealthLevelView(
  level: PortfolioHealthLevelApi,
): PortfolioHealthLevelView {
  switch (level) {
    case "healthy":
      return { label: "здоров", color: CHART.mint };
    case "warning":
      return { label: "тревога", color: CHART.amber };
    case "critical":
      return { label: "критично", color: CHART.red };
  }
}

export const PORTFOLIO_STATUS_DONUT_COLOR: Record<
  PortfolioProgressStatusKey,
  string
> = {
  achieved: CHART.cyan,
  on_track: CHART.mint,
  at_risk: CHART.amber,
  stalled: CHART.red,
  dropped: CHART.faint,
};

const STATUS_DONUT_ORDER: readonly PortfolioProgressStatusKey[] = [
  "on_track",
  "achieved",
  "at_risk",
  "stalled",
  "dropped",
] as const;

export function statusDonutSegments(
  byStatus: PortfolioByStatusApi,
): { name: string; value: number; c: string }[] {
  return STATUS_DONUT_ORDER.map((key) => ({
    name: PORTFOLIO_PROGRESS_LABELS[key],
    value: byStatus[key] ?? 0,
    c: PORTFOLIO_STATUS_DONUT_COLOR[key],
  }));
}

export interface PortfolioPriorityBucketDomain {
  priority: PortfolioPriorityKey;
  label: string;
  count: number;
  achievedCount: number;
  achievedPercent: number;
}

export interface PortfolioHealthRowDomain {
  goalId: string;
  name: string;
  progressStatus: string;
  priority: "must" | "should" | "could" | "wont" | null;
  hasSource: boolean;
}

export interface PortfolioHealthDomain {
  healthScore: number;
  level: PortfolioHealthLevelApi;
  levelView: PortfolioHealthLevelView;
  byStatus: PortfolioByStatusApi;
  statusSegments: { name: string; value: number; c: string }[];
  priorityBuckets: PortfolioPriorityBucketDomain[];
  rows: PortfolioHealthRowDomain[];
  deltaVsPrevWeek: number | null;
  isEmpty: boolean;
}

function rowFromApi(api: PortfolioHealthRowApi): PortfolioHealthRowDomain {
  return {
    goalId: api.goalId,
    name: api.name,
    progressStatus: api.progressStatus,
    priority: api.priority,
    hasSource: api.reason !== null && !!api.reason.sourceBlockId,
  };
}

function priorityBucketsFromApi(
  byPriority: PortfolioByPriorityApi,
): PortfolioPriorityBucketDomain[] {
  return PORTFOLIO_PRIORITY_ORDER.map((key) => {
    const b = byPriority[key];
    return {
      priority: key,
      label: PORTFOLIO_PRIORITY_LABELS[key],
      count: b?.count ?? 0,
      achievedCount: b?.achievedCount ?? 0,
      achievedPercent: b?.achievedPercent ?? 0,
    };
  }).filter((b) => b.count > 0);
}

export function portfolioHealthFromApi(
  api: PortfolioHealthApi,
): PortfolioHealthDomain {
  return {
    healthScore: api.healthScore,
    level: api.scale.level,
    levelView: portfolioHealthLevelView(api.scale.level),
    byStatus: api.byStatus,
    statusSegments: statusDonutSegments(api.byStatus),
    priorityBuckets: priorityBucketsFromApi(api.byPriority),
    rows: api.rows.map(rowFromApi),
    deltaVsPrevWeek: api.deltaVsPrevWeek,
    isEmpty: api.healthScore === 0 && api.rows.length === 0,
  };
}

export function sortRowsByPriority(
  rows: PortfolioHealthRowDomain[],
): PortfolioHealthRowDomain[] {
  const rank: Record<string, number> = {
    must: 0,
    should: 1,
    could: 2,
    wont: 3,
  };
  return [...rows].sort((a, b) => {
    const ra = a.priority ? rank[a.priority] : 4;
    const rb = b.priority ? rank[b.priority] : 4;
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name, "ru");
  });
}

export function deltaVsPrevWeekLabel(delta: number | null): string {
  if (delta === null) return "—";
  if (delta === 0) return "без изменений к прошлой неделе";
  const arrow = delta > 0 ? "↑" : "↓";
  return `${arrow} ${Math.abs(delta)} к прошлой неделе`;
}
