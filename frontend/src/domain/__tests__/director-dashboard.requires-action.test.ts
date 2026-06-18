import { describe, expect, it } from "vitest";

import type { PendingActionsCountApi } from "@/api/pending-actions.api";

import { mapPendingActionsCount } from "../pending-action";
import {
  directorDashboardFromApi,
  requiresActionTone,
  type DirectorDashboardApi,
} from "../director-dashboard";

function baseApi(): DirectorDashboardApi {
  return {
    period: "week",
    generatedAt: "2026-06-02T00:00:00.000Z",
    newThemes: [],
    newSignals: [],
    signalCounters: {
      pain: 0,
      feature_request: 0,
      churn_risk: 0,
      objection: 0,
      risk: 0,
      decision: 0,
      commitment: 0,
      other: 0,
    },
    activeThemes: [],
    hotEntities: [],
    openQuestions: [],
    narrativeSummary: null,
  };
}

describe("directorDashboardFromApi — requiresAction", () => {
  it("маппит requiresAction из DTO", () => {
    const dto = directorDashboardFromApi({
      ...baseApi(),
      requiresAction: {
        total: 4,
        bySource: { curation: 1, conflict: 2, intake: 1, probe: 0 },
      },
    });
    expect(dto.requiresAction).toEqual({
      total: 4,
      bySource: { curation: 1, conflict: 2, intake: 1, probe: 0 },
    });
  });

  it("защищает от отсутствующих ключей bySource", () => {
    const dto = directorDashboardFromApi({
      ...baseApi(),
      // @ts-expect-error — намеренно неполный bySource для проверки fallback'ов.
      requiresAction: { total: 1, bySource: { conflict: 1 } },
    });
    expect(dto.requiresAction).toEqual({
      total: 1,
      bySource: { curation: 0, conflict: 1, intake: 0, probe: 0 },
    });
  });

  it("нет requiresAction в DTO → null в Domain", () => {
    const dto = directorDashboardFromApi(baseApi());
    expect(dto.requiresAction).toBeNull();
  });
});

describe("directorDashboardFromApi — degraded (A11.5)", () => {
  it("degraded:true в DTO → true в Domain", () => {
    const dto = directorDashboardFromApi({ ...baseApi(), degraded: true });
    expect(dto.degraded).toBe(true);
  });

  it("degraded отсутствует в DTO → false в Domain (backward-compat)", () => {
    const dto = directorDashboardFromApi(baseApi());
    expect(dto.degraded).toBe(false);
  });

  it("degraded:false в DTO → false в Domain", () => {
    const dto = directorDashboardFromApi({ ...baseApi(), degraded: false });
    expect(dto.degraded).toBe(false);
  });
});

describe("requiresActionTone", () => {
  it("null → none", () => {
    expect(requiresActionTone(null)).toBe("none");
  });

  it("total=0 → none (никакого красного при нуле)", () => {
    expect(
      requiresActionTone({
        total: 0,
        bySource: { curation: 0, conflict: 0, intake: 0, probe: 0 },
      }),
    ).toBe("none");
  });

  it("есть конфликты → danger", () => {
    expect(
      requiresActionTone({
        total: 2,
        bySource: { curation: 0, conflict: 1, intake: 1, probe: 0 },
      }),
    ).toBe("danger");
  });

  it("обычные подтверждения без конфликтов → accent", () => {
    expect(
      requiresActionTone({
        total: 3,
        bySource: { curation: 2, conflict: 0, intake: 1, probe: 0 },
      }),
    ).toBe("accent");
  });
});

describe("Б-2 cross-surface — requiresAction (Сегодня) === pending-actions (/actions)", () => {
  const QUEUE = {
    total: 7,
    bySource: { curation: 3, conflict: 2, intake: 1, probe: 1 },
  } as const;

  it("оба источника дают один total при одинаковых данных очереди", () => {
    const today = directorDashboardFromApi({
      ...baseApi(),
      requiresAction: { total: QUEUE.total, bySource: { ...QUEUE.bySource } },
    });
    const actions = mapPendingActionsCount({
      total: QUEUE.total,
      bySource: { ...QUEUE.bySource },
    } satisfies PendingActionsCountApi);

    expect(today.requiresAction).not.toBeNull();
    expect(today.requiresAction?.total).toBe(actions.total);
  });

  it("оба источника дают одинаковый bySource (ни один из 4 источников не теряется)", () => {
    const today = directorDashboardFromApi({
      ...baseApi(),
      requiresAction: { total: QUEUE.total, bySource: { ...QUEUE.bySource } },
    });
    const actions = mapPendingActionsCount({
      total: QUEUE.total,
      bySource: { ...QUEUE.bySource },
    } satisfies PendingActionsCountApi);

    expect(today.requiresAction?.bySource).toEqual(actions.bySource);
    expect(Object.keys(actions.bySource).sort()).toEqual([
      "conflict",
      "curation",
      "intake",
      "probe",
    ]);
    expect(Object.keys(today.requiresAction?.bySource ?? {}).sort()).toEqual([
      "conflict",
      "curation",
      "intake",
      "probe",
    ]);
  });

  it("инвариант total === сумма bySource держится в обоих мапперах", () => {
    const today = directorDashboardFromApi({
      ...baseApi(),
      requiresAction: { total: QUEUE.total, bySource: { ...QUEUE.bySource } },
    });
    const actions = mapPendingActionsCount({
      total: QUEUE.total,
      bySource: { ...QUEUE.bySource },
    } satisfies PendingActionsCountApi);

    const sumOf = (b: {
      curation: number;
      conflict: number;
      intake: number;
      probe: number;
    }) => b.curation + b.conflict + b.intake + b.probe;

    expect(sumOf(QUEUE.bySource)).toBe(QUEUE.total);
    expect(today.requiresAction?.total).toBe(
      sumOf(today.requiresAction!.bySource),
    );
    expect(actions.total).toBe(sumOf(actions.bySource));
  });

  it("частично заданный bySource → оба маппера одинаково добивают нулями", () => {
    const today = directorDashboardFromApi({
      ...baseApi(),
      // @ts-expect-error — намеренно неполный bySource: проверяем нормализацию.
      requiresAction: { total: 2, bySource: { conflict: 1, intake: 1 } },
    });
    const actions = mapPendingActionsCount({
      total: 2,
      bySource: { curation: 0, conflict: 1, intake: 1, probe: 0 },
    });

    expect(today.requiresAction?.total).toBe(actions.total);
    expect(today.requiresAction?.bySource).toEqual(actions.bySource);
  });
});
