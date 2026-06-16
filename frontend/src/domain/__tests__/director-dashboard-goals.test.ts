import { describe, expect, it } from "vitest";

import {
  goalTreeNodeFromApi,
  goalTreeNodeToRenderNode,
  type GoalTreeNodeApi,
} from "../director-dashboard";

const leaf: GoalTreeNodeApi = {
  id: "kr-goal",
  name: "Квартальная цель",
  status: "active",
  progressStatus: "on_track",
  cachedAlignment: 72,
  weight: 0.5,
  parentGoalId: "root",
  keyResults: [
    {
      id: "kr-1",
      name: "Встречи с клиентами",
      progressPercent: 42,
      unit: "встреч",
    },
  ],
  children: [],
};

const root: GoalTreeNodeApi = {
  id: "root",
  name: "Стратегическая цель",
  status: "active",
  progressStatus: "at_risk",
  cachedAlignment: null,
  weight: 1,
  parentGoalId: null,
  keyResults: [],
  children: [leaf],
};

describe("goalTreeNodeFromApi", () => {
  it("маппит поля и рекурсивно проходит по children", () => {
    const out = goalTreeNodeFromApi(root);
    expect(out.id).toBe("root");
    expect(out.status).toBe("active");
    expect(out.progressStatus).toBe("at_risk");
    expect(out.cachedAlignment).toBeNull();
    expect(out.children).toHaveLength(1);
    const child = out.children[0]!;
    expect(child.id).toBe("kr-goal");
    expect(child.keyResults).toHaveLength(1);
    expect(child.keyResults[0]!.progressPercent).toBe(42);
    expect(child.keyResults[0]!.unit).toBe("встреч");
  });

  it("неизвестные status/progressStatus → безопасные дефолты", () => {
    const out = goalTreeNodeFromApi({
      ...root,
      status: "weird" as GoalTreeNodeApi["status"],
      progressStatus: "weird" as GoalTreeNodeApi["progressStatus"],
      children: [],
    });
    expect(out.status).toBe("active");
    expect(out.progressStatus).toBe("on_track");
  });

  it("отсутствие keyResults/children (undefined) → пустые массивы", () => {
    const out = goalTreeNodeFromApi({
      ...root,
      keyResults: undefined as unknown as GoalTreeNodeApi["keyResults"],
      children: undefined as unknown as GoalTreeNodeApi["children"],
    });
    expect(out.keyResults).toEqual([]);
    expect(out.children).toEqual([]);
  });
});

describe("goalTreeNodeToRenderNode", () => {
  it("адаптирует доменный узел в render-узел рекурсивно", () => {
    const domain = goalTreeNodeFromApi(root);
    const render = goalTreeNodeToRenderNode(domain);
    expect(render.id).toBe("root");
    expect(render.progressStatus).toBe("at_risk");
    expect(render.children).toHaveLength(1);
    expect(render.children[0]!.keyResults).toHaveLength(1);
    expect(render.children[0]!.keyResults![0]!.name).toBe(
      "Встречи с клиентами",
    );
  });
});
