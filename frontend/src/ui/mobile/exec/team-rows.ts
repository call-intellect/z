import type { StatusTone } from "@/ui/mobile/shared/StatusDot";
import type { OperationsOverviewDomain } from "@/domain/operations-dashboard";

export interface TeamRow {
  id: string;
  title: string;
  meta?: string;
  tone?: StatusTone;
  href?: string;
}

function personHref(personId: string | null): string | undefined {
  return personId
    ? `/structure/persons/${encodeURIComponent(personId)}`
    : undefined;
}

export function moodTone(
  greenShare: number,
  totalCheckIns: number,
): StatusTone {
  if (totalCheckIns === 0) return "neutral";
  if (greenShare >= 0.7) return "ok";
  if (greenShare >= 0.4) return "warn";
  return "danger";
}

export function moodGreenPercent(
  ui: OperationsOverviewDomain | null,
): number | null {
  const temp = ui?.teamTemperature;
  if (!temp || temp.totalCheckIns === 0) return null;
  return Math.round(temp.greenShare * 100);
}

export function teamHelpRows(ui: OperationsOverviewDomain | null): TeamRow[] {
  if (!ui) return [];
  const rows: TeamRow[] = [];

  for (const b of ui.topRecentBlockers) {
    const ownerName = b.ownerPersonName || b.ownerHint || null;
    const tone: StatusTone = b.severity === "high" ? "danger" : "warn";
    rows.push({
      id: `blocker-${b.id}`,
      title: b.text,
      meta: ownerName ? `${ownerName} · нужна помощь` : "нужна помощь",
      tone,
      href: personHref(b.ownerPersonId),
    });
  }

  for (const f of ui.topRecentTeamFrictions) {
    const from = f.fromPersonName || "участник";
    const to = f.toPersonName || "коллега";
    rows.push({
      id: `friction-${f.id}`,
      title: `${from} ↔ ${to}`,
      meta: "нужно сгладить",
      tone: "warn",
      href: personHref(f.fromPersonId),
    });
  }

  return rows;
}

export interface TeamStat {
  key: "blockers" | "frictions" | "overloaded";
  title: string;
  value: number;
  caption: string;
  tone: StatusTone;
}

export function teamSummaryStats(
  ui: OperationsOverviewDomain | null,
): TeamStat[] {
  if (!ui) return [];
  return [
    {
      key: "blockers",
      title: "Блокеры",
      value: ui.blockersCount,
      caption: ui.blockersCount > 0 ? "активных" : "нет",
      tone: ui.blockersCount > 0 ? "danger" : "ok",
    },
    {
      key: "frictions",
      title: "Трения",
      value: ui.teamFrictionCount,
      caption: ui.teamFrictionCount > 0 ? "в команде" : "нет",
      tone: ui.teamFrictionCount > 0 ? "warn" : "ok",
    },
    {
      key: "overloaded",
      title: "Перегружены",
      value: ui.capacityOverloadedCount,
      caption: ui.capacityOverloadedCount > 0 ? "нужна разгрузка" : "нет",
      tone: ui.capacityOverloadedCount > 0 ? "warn" : "ok",
    },
  ];
}

export function isTeamEmpty(ui: OperationsOverviewDomain | null): boolean {
  if (!ui) return true;
  return (
    ui.teamTemperature.totalCheckIns === 0 &&
    ui.blockersCount === 0 &&
    ui.teamFrictionCount === 0 &&
    ui.topRecentBlockers.length === 0 &&
    ui.topRecentTeamFrictions.length === 0
  );
}
