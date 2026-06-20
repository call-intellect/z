import type { GoalDomain, GoalHorizon, GoalProgressStatus } from "./goal";
import type { IdeaListItem, IdeaStatus } from "./idea";

export type GoalAlignment = "aligned" | "top_level" | "orphan";

export function computeGoalAlignment(
  goals: readonly GoalDomain[],
): Map<string, GoalAlignment> {
  const byId = new Map<string, GoalDomain>(goals.map((g) => [g.id, g]));
  const result = new Map<string, GoalAlignment>();

  const isTopLevel = (g: GoalDomain): boolean =>
    g.isPrimary || (g.parentGoalId === null && g.horizon === "strategic");

  const reachesPrimary = (start: GoalDomain): boolean => {
    const seen = new Set<string>();
    let cur: GoalDomain | undefined = start;
    while (cur) {
      if (seen.has(cur.id)) return false;
      seen.add(cur.id);
      if (cur.isPrimary) return true;
      if (cur.parentGoalId === null) return false;
      cur = byId.get(cur.parentGoalId);
    }
    return false;
  };

  for (const g of goals) {
    if (isTopLevel(g)) {
      result.set(g.id, "top_level");
    } else if (g.parentGoalId !== null && reachesPrimary(g)) {
      result.set(g.id, "aligned");
    } else {
      result.set(g.id, "orphan");
    }
  }
  return result;
}

export interface GoalMapNode {
  id: string;
  kind: "goal" | "idea";
  label: string;
  isPrimary: boolean;
  horizon: GoalHorizon | null;
  progressStatus: GoalProgressStatus | null;
  alignment: GoalAlignment | null;
  ideaStatus: IdeaStatus | null;
}

export interface GoalMapLink {
  source: string;
  target: string;
  kind: "parent" | "idea_goal";
}

export function buildGoalGraph(args: {
  goals: readonly GoalDomain[];
  alignment: Map<string, GoalAlignment>;
  ideas?: readonly IdeaListItem[];
  showIdeas: boolean;
}): { nodes: GoalMapNode[]; links: GoalMapLink[] } {
  const nodes: GoalMapNode[] = [];
  const links: GoalMapLink[] = [];
  const goalIds = new Set<string>(args.goals.map((g) => g.id));

  for (const g of args.goals) {
    nodes.push({
      id: g.id,
      kind: "goal",
      label: g.name,
      isPrimary: g.isPrimary,
      horizon: g.horizon,
      progressStatus: g.progressStatus,
      alignment: args.alignment.get(g.id) ?? "orphan",
      ideaStatus: null,
    });
    if (g.parentGoalId !== null && goalIds.has(g.parentGoalId)) {
      links.push({ source: g.id, target: g.parentGoalId, kind: "parent" });
    }
  }

  if (args.showIdeas && args.ideas) {
    for (const idea of args.ideas) {
      nodes.push({
        id: idea.id,
        kind: "idea",
        label: idea.statement,
        isPrimary: false,
        horizon: null,
        progressStatus: null,
        alignment: null,
        ideaStatus: idea.status,
      });
      if (idea.goalId !== null && goalIds.has(idea.goalId)) {
        links.push({ source: idea.id, target: idea.goalId, kind: "idea_goal" });
      }
    }
  }
  return { nodes, links };
}
