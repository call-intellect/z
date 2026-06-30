import { describe, expect, it } from "vitest";

import { mapDailyBrief } from "./daily-brief";
import type { BriefItemApi, DailyBriefApi } from "@/api/me/daily-brief.api";

function item(overrides: Partial<BriefItemApi> = {}): BriefItemApi {
  return {
    kind: "task",
    title: "Задача",
    dueDateIso: "2026-06-11T09:00:00.000Z",
    overdue: false,
    counterpartyName: null,
    ...overrides,
  };
}

function brief(overrides: Partial<DailyBriefApi> = {}): DailyBriefApi {
  return {
    id: "brief-1",
    dateLocal: "2026-06-11",
    myTasks: [],
    myBlockers: [],
    hint: "",
    knowsWho: null,
    counts: { tasks: 0, blockers: 0 },
    deliveredAt: null,
    openedAt: null,
    ...overrides,
  };
}

describe("mapDailyBrief — под рукой сегодня / под угрозой", () => {
  it("onDeckToday = задачи НЕ overdue; atRiskItems = overdue", () => {
    const dto = brief({
      myTasks: [
        item({ title: "T1", overdue: false }),
        item({ title: "T2", overdue: true }),
      ],
    });

    const d = mapDailyBrief(dto);
    expect(d.onDeckToday.map((i) => i.title)).toEqual(["T1"]);
    expect(d.atRiskItems.map((i) => i.title)).toEqual(["T2"]);
  });
});

describe("mapDailyBrief — переименования и типы", () => {
  it("dueDateIso → Date, null → null; counterpartyName пробрасывается", () => {
    const dto = brief({
      myTasks: [
        item({
          dueDateIso: "2026-06-11T09:00:00.000Z",
          counterpartyName: "Иван",
        }),
        item({ dueDateIso: null }),
      ],
    });
    const d = mapDailyBrief(dto);
    expect(d.myTasks[0].dueDate).toBeInstanceOf(Date);
    expect(d.myTasks[0].counterpartyName).toBe("Иван");
    expect(d.myTasks[1].dueDate).toBeNull();
  });

  it("knowsWho маппится, null → null", () => {
    expect(mapDailyBrief(brief()).knowsWho).toBeNull();
    const withWho = mapDailyBrief(
      brief({
        knowsWho: {
          blockId: "b1",
          blockerText: "оплата",
          expertPersonId: "p1",
          expertName: "Мария",
          confidence: 0.8,
        },
      }),
    );
    expect(withWho.knowsWho?.expertName).toBe("Мария");
  });

  it("insightCoOccurrence опционален: отсутствует на бэке → null", () => {
    expect(mapDailyBrief(brief()).insightCoOccurrence).toBeNull();
    const withInsight = mapDailyBrief(
      brief({
        insightCoOccurrence: {
          statement: "дедлайн жмёт",
          colleaguesCount: 3,
          escalated: false,
        },
      }),
    );
    expect(withInsight.insightCoOccurrence?.colleaguesCount).toBe(3);
  });
});

describe("mapDailyBrief — cold-start isEmpty", () => {
  it("пустой бриф без хинта → isEmpty=true", () => {
    expect(mapDailyBrief(brief()).isEmpty).toBe(true);
  });

  it("есть хинт → isEmpty=false", () => {
    expect(mapDailyBrief(brief({ hint: "Загляни в чек-ин" })).isEmpty).toBe(
      false,
    );
  });

  it("есть хотя бы один пункт → isEmpty=false", () => {
    expect(mapDailyBrief(brief({ myTasks: [item()] })).isEmpty).toBe(false);
  });
});
