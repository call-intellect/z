import { describe, expect, it } from "vitest";

import type {
  WeeklyPerPersonApi,
  WeeklyPersonRowApi,
} from "@/api/weekly-per-person.api";
import {
  pluralRu,
  reliabilityDisplay,
  reliabilityLabel,
  weeklyPerPersonFromApi,
  weeklyPersonRowFromApi,
} from "../weekly-per-person";

const baseRow: WeeklyPersonRowApi = {
  personId: "p_1",
  personName: "Иван Петров",
  departmentName: "Маркетинг",
  promisesGiven: 5,
  promisesKept: 4,
  promisesBroken: 1,
  promisesOverdue: 0,
  promisesNoAnswer: 0,
  reliabilityPercent: 80,
  tasksDone: 3,
  tasksPlanned: 4,
  tasksNotDone: 1,
  checkInsCompleted: 5,
  goalContributionNet: null,
};

describe("reliabilityLabel", () => {
  it("reliabilityPercent=null → «—»", () => {
    expect(reliabilityLabel(null)).toBe("—");
  });

  it("reliabilityPercent=80 → «80%»", () => {
    expect(reliabilityLabel(80)).toBe("80%");
  });

  it("округляет дробное до целого процента", () => {
    expect(reliabilityLabel(79.6)).toBe("80%");
    expect(reliabilityLabel(0)).toBe("0%");
    expect(reliabilityLabel(100)).toBe("100%");
  });
});

describe("reliabilityDisplay", () => {
  it("процент есть → {kind:percent, label:«NN%»}", () => {
    expect(reliabilityDisplay({ ...baseRow })).toEqual({
      kind: "percent",
      label: "80%",
    });
  });

  it("процента нет, но обещания были → {kind:low_data, «мало данных»}", () => {
    expect(
      reliabilityDisplay({
        ...baseRow,
        reliabilityPercent: null,
      }),
    ).toEqual({ kind: "low_data", label: "мало данных" });
  });

  it("процента нет и обещаний нет → {kind:none, «—»}", () => {
    expect(
      reliabilityDisplay({
        ...baseRow,
        reliabilityPercent: null,
        promisesKept: 0,
        promisesBroken: 0,
        promisesOverdue: 0,
      }),
    ).toEqual({ kind: "none", label: "—" });
  });

  it("процент округляется до целого", () => {
    expect(
      reliabilityDisplay({ ...baseRow, reliabilityPercent: 79.6 }),
    ).toEqual({ kind: "percent", label: "80%" });
  });
});

describe("weeklyPersonRowFromApi", () => {
  it("пробрасывает поля и добавляет reliabilityLabel", () => {
    const out = weeklyPersonRowFromApi(baseRow);
    expect(out.personId).toBe("p_1");
    expect(out.personName).toBe("Иван Петров");
    expect(out.departmentName).toBe("Маркетинг");
    expect(out.promisesGiven).toBe(5);
    expect(out.promisesKept).toBe(4);
    expect(out.promisesBroken).toBe(1);
    expect(out.promisesOverdue).toBe(0);
    expect(out.tasksDone).toBe(3);
    expect(out.checkInsCompleted).toBe(5);
    expect(out.reliabilityLabel).toBe("80%");
  });

  it("reliabilityPercent=null → reliabilityLabel «—», departmentName=null сохраняется", () => {
    const out = weeklyPersonRowFromApi({
      ...baseRow,
      reliabilityPercent: null,
      departmentName: null,
    });
    expect(out.reliabilityLabel).toBe("—");
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
    topRisk: [{ ...baseRow, personId: "p_2", reliabilityPercent: null }],
    rows: [baseRow, { ...baseRow, personId: "p_2", reliabilityPercent: null }],
  };

  it("маппит все три массива и проставляет reliabilityLabel", () => {
    const out = weeklyPerPersonFromApi(api);
    expect(out.weekStart).toBe("2026-06-01");
    expect(out.weekEnd).toBe("2026-06-07");
    expect(out.total).toBe(2);
    expect(out.topReliable).toHaveLength(1);
    expect(out.topReliable[0]!.reliabilityLabel).toBe("80%");
    expect(out.topRisk).toHaveLength(1);
    expect(out.topRisk[0]!.reliabilityLabel).toBe("—");
    expect(out.rows).toHaveLength(2);
    expect(out.rows[1]!.reliabilityLabel).toBe("—");
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
  const f: [string, string, string] = ["обещание", "обещания", "обещаний"];

  it("1 → «обещание»", () => {
    expect(pluralRu(1, f)).toBe("обещание");
  });

  it("2 → «обещания»", () => {
    expect(pluralRu(2, f)).toBe("обещания");
  });

  it("5 → «обещаний»", () => {
    expect(pluralRu(5, f)).toBe("обещаний");
  });

  it("21 → «обещание»", () => {
    expect(pluralRu(21, f)).toBe("обещание");
  });

  it("11–14 → форма «много» (обещаний)", () => {
    expect(pluralRu(11, f)).toBe("обещаний");
    expect(pluralRu(12, f)).toBe("обещаний");
    expect(pluralRu(14, f)).toBe("обещаний");
  });

  it("0 → «обещаний»", () => {
    expect(pluralRu(0, f)).toBe("обещаний");
  });

  it("22–24 → «обещания», 25 → «обещаний»", () => {
    expect(pluralRu(22, f)).toBe("обещания");
    expect(pluralRu(25, f)).toBe("обещаний");
  });
});
