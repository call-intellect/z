import type { DirectorDashboardDomain } from "@/domain/director-dashboard";
import type { OperationsOverviewDomain } from "@/domain/operations-dashboard";

export type ZoneTone = "ok" | "warn" | "danger" | "neutral";

export interface OverviewZone {
  key: "team" | "deals" | "goal" | "blockers";
  title: string;
  value: string;
  caption?: string;
  tone: ZoneTone;
  href: string;
  gaugePercent?: number | null;
}

function teamTone(greenShare: number, totalCheckIns: number): ZoneTone {
  if (totalCheckIns === 0) return "neutral";
  if (greenShare >= 0.7) return "ok";
  if (greenShare >= 0.4) return "warn";
  return "danger";
}

function reliabilityTone(percent: number | null): ZoneTone {
  if (percent === null) return "neutral";
  if (percent >= 80) return "ok";
  if (percent >= 60) return "warn";
  return "danger";
}

function alignmentTone(percent: number | null): ZoneTone {
  if (percent === null) return "neutral";
  if (percent >= 70) return "ok";
  if (percent >= 40) return "warn";
  return "danger";
}

export function requiresYouCount(
  director: DirectorDashboardDomain | null,
): number {
  if (!director) return 0;
  if (director.requiresAction) return director.requiresAction.total;
  const c = director.signalCounters;
  if (!c) return 0;
  return (
    c.pain +
    c.feature_request +
    c.churn_risk +
    c.objection +
    c.risk +
    c.commitment +
    c.other
  );
}

export function mainGoalPercent(
  director: DirectorDashboardDomain | null,
): number | null {
  if (!director) return null;
  const avg = director.strategicAlignment?.average;
  if (avg !== null && avg !== undefined) return Math.round(avg * 100);
  const pulse = director.goalsPulse;
  if (pulse && pulse.total > 0) {
    const denom = pulse.total - pulse.droppedCount;
    if (denom > 0) return Math.round((pulse.onTrackCount / denom) * 100);
  }
  return null;
}

export function commitmentReliabilityPercent(
  director: DirectorDashboardDomain | null,
): number | null {
  const v = director?.kpiCommitmentReliability?.value;
  return v === null || v === undefined ? null : Math.round(v);
}

export function overviewZonesFromDomain(
  director: DirectorDashboardDomain | null,
  operations: OperationsOverviewDomain | null,
): OverviewZone[] {
  const temp = operations?.teamTemperature;
  const greenShare = temp?.greenShare ?? 0;
  const totalCheckIns = temp?.totalCheckIns ?? 0;
  const greenPct = Math.round(greenShare * 100);
  const teamZone: OverviewZone = {
    key: "team",
    title: "Команда",
    value: operations ? (totalCheckIns > 0 ? `${greenPct}%` : "—") : "—",
    caption: totalCheckIns > 0 ? "в добром настрое" : "нет чек-инов за неделю",
    tone: teamTone(greenShare, totalCheckIns),
    href: "/dashboard/operations",
  };

  const reliability = commitmentReliabilityPercent(director);
  const dealsZone: OverviewZone = {
    key: "deals",
    title: "Дела",
    value: reliability === null ? "—" : `${reliability}%`,
    caption: "обещания держим",
    tone: reliabilityTone(reliability),
    href: "/dashboard/operations/weekly",
  };

  const goalPct = mainGoalPercent(director);
  const goalZone: OverviewZone = {
    key: "goal",
    title: "Главная цель",
    value: goalPct === null ? "нет данных" : `${goalPct}%`,
    caption: "движемся к цели",
    tone: alignmentTone(goalPct),
    href: "/goals",
    gaugePercent: goalPct,
  };

  const blockers = operations?.blockersCount ?? 0;
  const blockersZone: OverviewZone = {
    key: "blockers",
    title: "Что мешает",
    value: operations ? String(blockers) : "—",
    caption: blockers > 0 ? "активных блокеров" : "блокеров нет",
    tone: blockers > 0 ? "danger" : operations ? "ok" : "neutral",
    href: "/dashboard/operations",
  };

  return [teamZone, dealsZone, goalZone, blockersZone];
}

export function isOverviewColdStart(
  director: DirectorDashboardDomain | null,
): boolean {
  return director?.isEmpty === true;
}
