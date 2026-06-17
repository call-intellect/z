import { describe, expect, it } from "vitest";

import type { GoalDomain } from "@/domain/goal";
import {
  goalTone,
  goalsKeyRows,
  mainGoal,
  mainGoalPercent,
} from "./goals-rows";

function goal(over: Partial<GoalDomain> = {}): GoalDomain {
  return {
    id: "g1",
    name: "Цель",
    description: "",
    targetDate: null,
    status: "active",
    weight: 1,
    cachedAlignment: null,
    cachedAlignmentAt: null,
    cachedAlignmentDelta: null,
    themesCount: 0,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    source: "manual",
    promotionState: "active",
    progressStatus: "on_track",
    parentGoalId: null,
    ownerPersonId: null,
    ownerPersonName: null,
    blocksCount: null,
    ...over,
  };
}

describe("mainGoal", () => {
  it("пустой список → null", () => {
    expect(mainGoal([])).toBeNull();
  });

  it("берёт цель с наибольшим весом", () => {
    const list = [
      goal({ id: "a", name: "A", weight: 0.3 }),
      goal({ id: "b", name: "B", weight: 0.9 }),
      goal({ id: "c", name: "C", weight: 0.5 }),
    ];
    expect(mainGoal(list)!.id).toBe("b");
  });

  it("при равных весах — первая по порядку", () => {
    const list = [
      goal({ id: "a", weight: 0.5 }),
      goal({ id: "b", weight: 0.5 }),
    ];
    expect(mainGoal(list)!.id).toBe("a");
  });
});

describe("mainGoalPercent / goalTone", () => {
  it("cachedAlignment 82 → 82 / ok", () => {
    const g = goal({ cachedAlignment: 82 });
    expect(mainGoalPercent(g)).toBe(82);
    expect(goalTone(mainGoalPercent(g))).toBe("ok");
  });

  it("null alignment → null / neutral", () => {
    const g = goal({ cachedAlignment: null });
    expect(mainGoalPercent(g)).toBeNull();
    expect(goalTone(null)).toBe("neutral");
  });

  it("пороги: 70 ok, 40 warn, 39 danger", () => {
    expect(goalTone(70)).toBe("ok");
    expect(goalTone(40)).toBe("warn");
    expect(goalTone(39)).toBe("danger");
  });

  it("clamp >100 → 100", () => {
    expect(mainGoalPercent(goal({ cachedAlignment: 150 }))).toBe(100);
  });
});

describe("goalsKeyRows", () => {
  it("исключает главную цель, остальные → строки с %/тоном/ссылкой", () => {
    const list = [
      goal({ id: "main", weight: 1, cachedAlignment: 90 }),
      goal({ id: "kr1", name: "KR1", weight: 0.2, cachedAlignment: 50 }),
      goal({ id: "kr2", name: "KR2", weight: 0.1, cachedAlignment: null }),
    ];
    const rows = goalsKeyRows(list, "main");
    expect(rows.map((r) => r.id)).toEqual(["kr1", "kr2"]);
    expect(rows[0].meta).toBe("50%");
    expect(rows[0].tone).toBe("warn");
    expect(rows[0].href).toBe("/goals/kr1");
    expect(rows[1].meta).toBe("нет данных");
    expect(rows[1].tone).toBe("neutral");
  });

  it("mainId=null → ни одна не исключена", () => {
    const list = [goal({ id: "g1" }), goal({ id: "g2" })];
    expect(goalsKeyRows(list, null)).toHaveLength(2);
  });
});
