import { describe, expect, it } from "vitest";

import type {
  WeeklyPerPersonApi,
  WeeklyPersonRowApi,
} from "@/api/weekly-per-person.api";
import {
  pluralRu,
  weeklyPerPersonFromApi,
  weeklyPersonRowFromApi,
} from "../weekly-per-person";

const baseRow: WeeklyPersonRowApi = {
  personId: "p_1",
  personName: "Иван Петров",
  departmentName: "Маркетинг",
  tasksDone: 3,
  tasksPlanned: 4,
  tasksNotDone: 1,
  checkInsCompleted: 5,
  goalContributionNet: null,
};

describe("weeklyPersonRowFromApi", () => {
  it("пробрасывает поля", () => {
    const out = weeklyPersonRowFromApi(baseRow);
    expect(out.personId).toBe("p_1");
    expect(out.personName).toBe("Иван Петров");
    expect(out.departmentName).toBe("Маркетинг");
    expect(out.tasksDone).toBe(3);
    expect(out.tasksPlanned).toBe(4);
    expect(out.tasksNotDone).toBe(1);
    expect(out.checkInsCompleted).toBe(5);
  });

  it("departmentName=null сохраняется", () => {
    const out = weeklyPersonRowFromApi({
      ...baseRow,
      departmentName: null,
    });
    expect(out.departmentName).toBeNull();
  });
});

describe("weeklyPerPersonFromApi", () => {
  const api: WeeklyPerPersonApi = {
    weekStart: "2026-06-01",
    weekEnd: "2026-06-07",
    generatedAt: "2026-06-08T03:00:00.000Z",
    total: 2,
    topReliable: [baseRow],
    topRisk: [{ ...baseRow, personId: "p_2" }],
    rows: [baseRow, { ...baseRow, personId: "p_2" }],
  };

  it("маппит все три массива", () => {
    const out = weeklyPerPersonFromApi(api);
    expect(out.weekStart).toBe("2026-06-01");
    expect(out.weekEnd).toBe("2026-06-07");
    expect(out.total).toBe(2);
    expect(out.topReliable).toHaveLength(1);
    expect(out.topRisk).toHaveLength(1);
    expect(out.rows).toHaveLength(2);
  });

  it("защита от undefined-массивов (старый бэк) → пустые массивы", () => {
    const out = weeklyPerPersonFromApi({
      ...api,
      topReliable: undefined as unknown as WeeklyPersonRowApi[],
      topRisk: undefined as unknown as WeeklyPersonRowApi[],
      rows: undefined as unknown as WeeklyPersonRowApi[],
    });
    expect(out.topReliable).toEqual([]);
    expect(out.topRisk).toEqual([]);
    expect(out.rows).toEqual([]);
  });
});

describe("pluralRu", () => {
  const f: [string, string, string] = ["задача", "задачи", "задач"];

  it("1 → первая форма", () => {
    expect(pluralRu(1, f)).toBe("задача");
  });

  it("2 → вторая форма", () => {
    expect(pluralRu(2, f)).toBe("задачи");
  });

  it("5 → третья форма", () => {
    expect(pluralRu(5, f)).toBe("задач");
  });

  it("21 → первая форма", () => {
    expect(pluralRu(21, f)).toBe("задача");
  });

  it("11–14 → третья форма", () => {
    expect(pluralRu(11, f)).toBe("задач");
    expect(pluralRu(12, f)).toBe("задач");
    expect(pluralRu(14, f)).toBe("задач");
  });

  it("0 → третья форма", () => {
    expect(pluralRu(0, f)).toBe("задач");
  });

  it("22–24 → вторая форма, 25 → третья", () => {
    expect(pluralRu(22, f)).toBe("задачи");
    expect(pluralRu(25, f)).toBe("задач");
  });
});
