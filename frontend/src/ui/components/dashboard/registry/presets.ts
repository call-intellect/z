import type { DashboardRole, Rhythm } from "./types";

export const DEFAULT_PRESETS: Record<DashboardRole, Record<Rhythm, string[]>> = {
  owner: {
    today: ["demo.always", "demo.conditional"],
    week: ["demo.always", "demo.conditional"],
    month: ["demo.always", "demo.conditional"],
  },
  coo: {
    today: ["demo.always", "demo.conditional"],
    week: ["demo.always", "demo.conditional"],
    month: ["demo.always", "demo.conditional"],
  },
  member: {
    today: ["demo.always"],
    week: ["demo.always"],
    month: ["demo.always"],
  },
};

export function toDashboardRole(
  orgRole: string | null | undefined,
): DashboardRole {
  if (orgRole === "owner" || orgRole === "admin") return "owner";
  if (orgRole === "coo") return "coo";
  return "member";
}
