import { describe, expect, it } from "vitest";

import type { GoalDomain } from "./goal";
import {
  buildGoalGraph,
  computeGoalAlignment,
  type GoalAlignment,
} from "./goal-map";
import type { IdeaListItem } from "./idea";

function goal(over: Partial<GoalDomain> & { id: string }): GoalDomain {
  return {
    name: over.name ?? `Цель ${over.id}`,
    description: "",
    targetDate: null,
    status: "active",
    weight: 1,
    cachedAlignment: null,
    cachedAlignmentAt: null,
    cachedAlignmentDelta: null,
    themesCount: 0,
    archivedAt: null,
    createdAt: new Date("2026-06-01T10:00:00.000Z"),
    updatedAt: new Date("2026-06-01T10:00:00.000Z"),
    source: "manual",
    promotionState: "active",
    progressStatus: "on_track",
    parentGoalId: null,
    isPrimary: false,
    horizon: "quarterly",
    ownerPersonId: null,
    ownerPersonName: null,
    blocksCount: null,
    ...over,
  };
}

function idea(over: Partial<IdeaListItem> & { id: string }): IdeaListItem {
  return {
    kind: "internal",
    status: "captured",
    statement: over.statement ?? `Идея ${over.id}`,
    rationale: null,
    weight: 1,
    supporterCount: 1,
    clusterId: null,
    firstProposedAt: new Date("2026-06-01T10:00:00.000Z"),
    lastDiscussedAt: new Date("2026-06-01T10:00:00.000Z"),
    createdByUserId: null,
    goalId: null,
    ...over,
  };
}

describe("computeGoalAlignment", () => {
  it("isPrimary-цель → top_level", () => {
    const a = computeGoalAlignment([goal({ id: "p", isPrimary: true })]);
    expect(a.get("p")).toBe<GoalAlignment>("top_level");
  });

  it("parentGoalId=null && horizon=strategic → top_level", () => {
    const a = computeGoalAlignment([
      goal({ id: "s", parentGoalId: null, horizon: "strategic" }),
    ]);
    expect(a.get("s")).toBe("top_level");
  });

  it("parentGoalId=null && horizon=quarterly → orphan", () => {
    const a = computeGoalAlignment([
      goal({ id: "q", parentGoalId: null, horizon: "quarterly" }),
    ]);
    expect(a.get("q")).toBe("orphan");
  });

  it("цепочка достигает isPrimary → aligned", () => {
    const goals = [
      goal({ id: "p", isPrimary: true }),
      goal({ id: "c1", parentGoalId: "p" }),
      goal({ id: "c2", parentGoalId: "c1" }),
    ];
    const a = computeGoalAlignment(goals);
    expect(a.get("p")).toBe("top_level");
    expect(a.get("c1")).toBe("aligned");
    expect(a.get("c2")).toBe("aligned");
  });

  it("цепочка к не-primary не-strategic корню → orphan", () => {
    const goals = [
      goal({ id: "root", parentGoalId: null, horizon: "quarterly", isPrimary: false }),
      goal({ id: "child", parentGoalId: "root" }),
    ];
    const a = computeGoalAlignment(goals);
    expect(a.get("root")).toBe("orphan");
    expect(a.get("child")).toBe("orphan");
  });

  it("родитель вне набора (битая ссылка) → orphan", () => {
    const a = computeGoalAlignment([goal({ id: "x", parentGoalId: "missing" })]);
    expect(a.get("x")).toBe("orphan");
  });

  it("циклическая parentGoalId → не зацикливается, узлы orphan", () => {
    const goals = [
      goal({ id: "a", parentGoalId: "b" }),
      goal({ id: "b", parentGoalId: "a" }),
    ];
    const a = computeGoalAlignment(goals);
    expect(a.get("a")).toBe("orphan");
    expect(a.get("b")).toBe("orphan");
  });
});

describe("buildGoalGraph", () => {
  const goals = [
    goal({ id: "p", isPrimary: true }),
    goal({ id: "c1", parentGoalId: "p" }),
    goal({ id: "orph", parentGoalId: null, horizon: "monthly" }),
  ];
  const alignment = computeGoalAlignment(goals);

  it("showIdeas=false → ни одного idea-узла", () => {
    const ideas = [idea({ id: "i1", goalId: "p" })];
    const { nodes, links } = buildGoalGraph({ goals, alignment, ideas, showIdeas: false });
    expect(nodes.filter((n) => n.kind === "idea")).toHaveLength(0);
    expect(links.filter((l) => l.kind === "idea_goal")).toHaveLength(0);
    expect(nodes.filter((n) => n.kind === "goal")).toHaveLength(3);
  });

  it("рёбра parent только между целями набора", () => {
    const { links } = buildGoalGraph({ goals, alignment, showIdeas: false });
    const parentLinks = links.filter((l) => l.kind === "parent");
    expect(parentLinks).toEqual([{ source: "c1", target: "p", kind: "parent" }]);
  });

  it("центр-узел несёт isPrimary и alignment", () => {
    const { nodes } = buildGoalGraph({ goals, alignment, showIdeas: false });
    const primary = nodes.find((n) => n.id === "p");
    expect(primary?.isPrimary).toBe(true);
    expect(primary?.alignment).toBe("top_level");
    const orph = nodes.find((n) => n.id === "orph");
    expect(orph?.alignment).toBe("orphan");
  });

  it("showIdeas=true → idea-узлы + ребро idea_goal; idea goalId=null → узел без ребра", () => {
    const ideas = [
      idea({ id: "i1", goalId: "p" }),
      idea({ id: "i2", goalId: null }),
    ];
    const { nodes, links } = buildGoalGraph({ goals, alignment, ideas, showIdeas: true });
    const ideaNodes = nodes.filter((n) => n.kind === "idea");
    expect(ideaNodes).toHaveLength(2);
    expect(ideaNodes.every((n) => n.ideaStatus === "captured")).toBe(true);
    const ideaLinks = links.filter((l) => l.kind === "idea_goal");
    expect(ideaLinks).toEqual([{ source: "i1", target: "p", kind: "idea_goal" }]);
  });

  it("idea с goalId вне набора целей → узел без ребра", () => {
    const ideas = [idea({ id: "i3", goalId: "ghost" })];
    const { nodes, links } = buildGoalGraph({ goals, alignment, ideas, showIdeas: true });
    expect(nodes.some((n) => n.id === "i3")).toBe(true);
    expect(links.filter((l) => l.kind === "idea_goal")).toHaveLength(0);
  });
});
