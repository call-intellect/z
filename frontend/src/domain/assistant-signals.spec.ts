import { describe, expect, it } from "vitest";

import {
  PROACTIVE_RULE_LABEL,
  PROACTIVE_RULE_ROUTE,
  mapProactiveToBellRow,
  mapSignalToBellRow,
} from "./assistant-signals";
import type { ProactiveNotificationApi } from "@/api/proactive.api";
import type { FeedItemApi } from "@/domain/activity-feed";

const WATCHER_RULE_TYPES = [
  "decision_no_owner",
  "insight_no_mitigation",
  "experiment_running_too_long",
  "process_stale_review",
  "role_low_completeness",
  "department_no_domain",
  "insights_siloed_in_domain",
  "plan_item_overdue",
] as const;

const LATIN_SNAKE = /^[a-z][a-z0-9_]+$/;

function proactive(
  overrides: Partial<ProactiveNotificationApi> = {},
): ProactiveNotificationApi {
  return {
    id: "1",
    ruleType: "decision_no_owner",
    severity: "high",
    payload: {},
    notificationId: null,
    emittedAt: "2026-06-20T00:00:00.000Z",
    dismissedAt: null,
    ...overrides,
  };
}

function signal(overrides: Partial<FeedItemApi> = {}): FeedItemApi {
  return {
    id: "s1",
    feedType: "insight",
    title: "Выручка падает",
    summary: null,
    severity: "critical",
    status: "emitted",
    emittedAt: "2026-06-20T00:00:00.000Z",
    respondedAt: null,
    ...overrides,
  };
}

describe("mapProactiveToBellRow", () => {
  it("использует справочник для известного правила без payload", () => {
    const row = mapProactiveToBellRow(proactive());
    expect(row).not.toBeNull();
    expect(row?.title).toBe("Решение без ответственного");
    expect(row?.actionUrl).toBe("/decisions");
    expect(row?.group).toBe("proactive");
    expect(row?.severity).toBe("urgent");
  });

  it("предпочитает payload.actionUrl и payload.title", () => {
    const row = mapProactiveToBellRow(
      proactive({ payload: { actionUrl: "/decisions/abc", title: "Кастом" } }),
    );
    expect(row?.actionUrl).toBe("/decisions/abc");
    expect(row?.title).toBe("Кастом");
  });

  it("возвращает null для неизвестного правила с пустым payload", () => {
    const row = mapProactiveToBellRow(
      proactive({ ruleType: "table_cells_enriched", payload: {} }),
    );
    expect(row).toBeNull();
  });
});

describe("mapSignalToBellRow", () => {
  it("маппит критический insight в срочный ряд", () => {
    const row = mapSignalToBellRow(signal());
    expect(row?.actionUrl).toBe("/insights");
    expect(row?.severity).toBe("urgent");
    expect(row?.title).toBe("Выручка падает");
  });
});

describe("паритет watcher-правил со справочниками", () => {
  it("каждое правило имеет человекочитаемую метку и маршрут", () => {
    for (const rt of WATCHER_RULE_TYPES) {
      const label = PROACTIVE_RULE_LABEL[rt];
      expect(label).toBeDefined();
      expect(label).not.toBe(rt);
      expect(PROACTIVE_RULE_ROUTE[rt]).toBeDefined();
    }
  });
});

describe("ни один заголовок не остаётся latin_snake-слагом", () => {
  it("proactive на валидных входах", () => {
    for (const rt of WATCHER_RULE_TYPES) {
      const row = mapProactiveToBellRow(proactive({ ruleType: rt }));
      expect(row?.title).toBeDefined();
      expect(LATIN_SNAKE.test(row!.title)).toBe(false);
    }
  });

  it("signal на валидном входе", () => {
    const row = mapSignalToBellRow(signal());
    expect(LATIN_SNAKE.test(row!.title)).toBe(false);
  });
});
