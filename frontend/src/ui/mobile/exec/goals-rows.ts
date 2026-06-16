import type { StatusTone } from "@/ui/mobile/shared/StatusDot";
import type { GoalDomain } from "@/domain/goal";

export interface GoalsRow {
  id: string;
  title: string;
  meta?: string;
  tone?: StatusTone;
  href?: string;
}

export function mainGoal(goals: readonly GoalDomain[]): GoalDomain | null {
  if (goals.length === 0) return null;
  let best = goals[0];
  for (const g of goals) {
    if (g.weight > best.weight) best = g;
  }
  return best;
}

export function mainGoalPercent(goal: GoalDomain | null): number | null {
  if (!goal || goal.cachedAlignment === null) return null;
  return Math.round(Math.max(0, Math.min(100, goal.cachedAlignment)));
}

export function goalTone(percent: number | null): StatusTone {
  if (percent === null) return "neutral";
  if (percent >= 70) return "ok";
  if (percent >= 40) return "warn";
  return "danger";
}

export function goalsKeyRows(
  goals: readonly GoalDomain[],
  mainId: string | null,
): GoalsRow[] {
  return goals
    .filter((g) => g.id !== mainId)
    .map((g) => {
      const pct =
        g.cachedAlignment === null ? null : Math.round(g.cachedAlignment);
      return {
        id: g.id,
        title: g.name,
        meta: pct === null ? "нет данных" : `${pct}%`,
        tone: goalTone(pct),
        href: `/goals/${encodeURIComponent(g.id)}`,
      };
    });
}
