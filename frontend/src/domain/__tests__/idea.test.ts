import { describe, expect, it } from "vitest";

import { mapIdeaDetail, mapIdeaListItem } from "../idea";
import type { IdeaDetailApi, IdeaListItemApi } from "@/api/ideas.api";

const baseListItem: IdeaListItemApi = {
  id: "idea_1",
  kind: "internal",
  status: "captured",
  statement: "Добавить тёмную тему",
  rationale: null,
  weight: 3.5,
  supporterCount: 2,
  clusterId: null,
  firstProposedAt: "2026-06-01T10:00:00.000Z",
  lastDiscussedAt: "2026-06-02T12:00:00.000Z",
  createdByUserId: "user_1",
  goalId: "goal_42",
};

const baseDetail: IdeaDetailApi = {
  ...baseListItem,
  supporters: [],
  sourceBlockIds: [],
  personSubjectIds: [],
  statusChangedAt: null,
  statusChangedByUserId: null,
  statusReason: null,
  confidence: 0.8,
  dataClass: "internal",
  realizedAsDecisionId: null,
};

describe("mapIdeaListItem — goalId", () => {
  it("пробрасывает строковый goalId", () => {
    const out = mapIdeaListItem(baseListItem);
    expect(out.goalId).toBe("goal_42");
  });

  it("сохраняет goalId=null", () => {
    const out = mapIdeaListItem({ ...baseListItem, goalId: null });
    expect(out.goalId).toBeNull();
  });

  it("дефолт null, если goalId отсутствует (старый бэк)", () => {
    const { goalId: _omit, ...withoutGoal } = baseListItem;
    const out = mapIdeaListItem(withoutGoal as IdeaListItemApi);
    expect(out.goalId).toBeNull();
  });
});

describe("mapIdeaDetail — goalId", () => {
  it("пробрасывает строковый goalId через spread mapIdeaListItem", () => {
    const out = mapIdeaDetail(baseDetail);
    expect(out.goalId).toBe("goal_42");
  });

  it("сохраняет goalId=null", () => {
    const out = mapIdeaDetail({ ...baseDetail, goalId: null });
    expect(out.goalId).toBeNull();
  });
});

describe("mapIdeaDetail — realizedAsDecisionId", () => {
  it("пробрасывает строковый realizedAsDecisionId", () => {
    const out = mapIdeaDetail({ ...baseDetail, realizedAsDecisionId: "dec_7" });
    expect(out.realizedAsDecisionId).toBe("dec_7");
  });

  it("сохраняет realizedAsDecisionId=null", () => {
    const out = mapIdeaDetail(baseDetail);
    expect(out.realizedAsDecisionId).toBeNull();
  });

  it("дефолт null, если realizedAsDecisionId отсутствует (старый бэк)", () => {
    const { realizedAsDecisionId: _omit, ...without } = baseDetail;
    const out = mapIdeaDetail(without as IdeaDetailApi);
    expect(out.realizedAsDecisionId).toBeNull();
  });
});
