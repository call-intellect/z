import type { DashboardRole, Rhythm } from "./types";

export const DEFAULT_PRESETS: Record<DashboardRole, Record<Rhythm, string[]>> = {
  owner: {
    today: [
      "verdict",
      "goal-vector",
      "plan-fact",
      "load",
      "stale",
      "blockers",
      "ideas",
      "decisions",
      "feed",
      "value",
    ],
    week: [
      "verdict",
      "goal-vector",
      "plan-fact",
      "load",
      "stale",
      "chains",
      "blockers",
      "ideas",
      "decisions",
      "feed",
      "value",
    ],
    month: [
      "verdict",
      "goal-vector",
      "plan-fact",
      "load",
      "stale",
      "chains",
      "blockers",
      "ideas",
      "decisions",
      "feed",
      "value",
    ],
  },
  coo: {
    today: [
      "verdict",
      "goal-vector",
      "plan-fact",
      "load",
      "stale",
      "blockers",
      "ideas",
      "decisions",
      "feed",
      "value",
    ],
    week: [
      "verdict",
      "goal-vector",
      "plan-fact",
      "load",
      "stale",
      "chains",
      "blockers",
      "ideas",
      "decisions",
      "feed",
      "value",
    ],
    month: [
      "verdict",
      "goal-vector",
      "plan-fact",
      "load",
      "stale",
      "chains",
      "blockers",
      "ideas",
      "decisions",
      "feed",
      "value",
    ],
  },
  member: {
    today: ["ideas", "value"],
    week: ["ideas", "value"],
    month: ["ideas", "value"],
  },
};

export function toDashboardRole(
  orgRole: string | null | undefined,
): DashboardRole {
  if (orgRole === "owner" || orgRole === "admin") return "owner";
  if (orgRole === "coo") return "coo";
  return "member";
}
