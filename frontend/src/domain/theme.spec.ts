import { describe, expect, it } from "vitest";

import type {
  ThemeApi,
  ThemeBlockApi,
  ThemeDetailApi,
} from "./theme";
import {
  themeBlockFromApi,
  themeDetailFromApi,
  themeFromApi,
} from "./theme";

function themeApi(overrides: Partial<ThemeApi> = {}): ThemeApi {
  return {
    id: "t-1",
    name: "Клиент Логистик Плюс",
    description: "Всё про клиента",
    branch: "clients",
    status: "active",
    weight: 1,
    confidence: 0.8,
    dynamic: "growing",
    lastSignalAt: null,
    blocksCount: 3,
    entitiesCount: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function blockApi(overrides: Partial<ThemeBlockApi> = {}): ThemeBlockApi {
  return {
    id: "b-1",
    name: "Оплата задерживается",
    criticalQuestion: "Почему?",
    trustedAnswer: "Ждут закрывающие",
    signalType: "commitment",
    tags: [],
    confidence: 0.7,
    evidenceCount: 4,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function detailApi(overrides: Partial<ThemeDetailApi> = {}): ThemeDetailApi {
  return {
    theme: themeApi(),
    blocks: [blockApi()],
    entities: [],
    ...overrides,
  };
}

describe("themeFromApi — новые поля", () => {
  it("origin/visibility/isMine пробрасываются", () => {
    const d = themeFromApi(
      themeApi({ origin: "user", visibility: "team", isMine: true }),
    );
    expect(d.origin).toBe("user");
    expect(d.visibility).toBe("team");
    expect(d.isMine).toBe(true);
  });

  it("дефолты при отсутствии полей", () => {
    const d = themeFromApi(themeApi());
    expect(d.origin).toBe("auto");
    expect(d.visibility).toBe("personal");
    expect(d.isMine).toBe(false);
  });

  it("неизвестные значения падают в дефолт", () => {
    const d = themeFromApi(
      themeApi({ origin: "wtf", visibility: "nope" }),
    );
    expect(d.origin).toBe("auto");
    expect(d.visibility).toBe("personal");
  });
});

describe("themeBlockFromApi — addedVia/score/reason", () => {
  it("пробрасывает значения", () => {
    const b = themeBlockFromApi(
      blockApi({ addedVia: "autofill", score: 0.86, reason: "4 упоминания" }),
    );
    expect(b.addedVia).toBe("autofill");
    expect(b.score).toBe(0.86);
    expect(b.reason).toBe("4 упоминания");
  });

  it("дефолты при отсутствии", () => {
    const b = themeBlockFromApi(blockApi());
    expect(b.addedVia).toBe("clustered");
    expect(b.score).toBeNull();
    expect(b.reason).toBeNull();
  });

  it("неизвестный addedVia → clustered", () => {
    const b = themeBlockFromApi(blockApi({ addedVia: "xxx" }));
    expect(b.addedVia).toBe("clustered");
  });
});

describe("themeDetailFromApi — новые секции", () => {
  it("маппит decisions/tasks/documents/regulations", () => {
    const detail = themeDetailFromApi(
      detailApi({
        decisions: [
          {
            id: "d-1",
            statement: "Продлить контракт",
            reversibility: "type-2",
            href: "/decisions/d-1",
          },
        ],
        tasks: [{ id: "task-1", title: "Позвонить", href: "/issues/task-1" }],
        documents: [
          { id: "doc-1", title: "Договор", href: "/documents/doc-1" },
        ],
        regulations: [
          {
            id: "reg-1",
            title: "Регламент оплаты",
            category: "finance",
            href: "/regulations/reg-1",
          },
        ],
      }),
    );

    expect(detail.decisions).toHaveLength(1);
    expect(detail.decisions[0]?.statement).toBe("Продлить контракт");
    expect(detail.tasks[0]?.href).toBe("/issues/task-1");
    expect(detail.documents[0]?.title).toBe("Договор");
    expect(detail.regulations[0]?.category).toBe("finance");
  });

  it("отсутствие секций → пустые массивы", () => {
    const detail = themeDetailFromApi(detailApi());
    expect(detail.decisions).toEqual([]);
    expect(detail.tasks).toEqual([]);
    expect(detail.documents).toEqual([]);
    expect(detail.regulations).toEqual([]);
  });

  it("blocks маппятся с addedVia/score/reason", () => {
    const detail = themeDetailFromApi(
      detailApi({
        blocks: [blockApi({ addedVia: "manual", score: 0.5, reason: "вручную" })],
      }),
    );
    expect(detail.blocks[0]?.addedVia).toBe("manual");
    expect(detail.blocks[0]?.score).toBe(0.5);
  });
});
