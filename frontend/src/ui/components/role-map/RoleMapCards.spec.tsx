import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import type { RoleMapApi } from "@/api/role-map.api";

import { RoleMapGrid, isRoleMapEmpty } from "./RoleMapCards";

function baseMap(overrides: Partial<RoleMapApi> = {}): RoleMapApi {
  return {
    role: {
      id: "r1",
      name: "Маркетолог",
      departmentId: null,
      departmentName: null,
      missionStatement: null,
    },
    responsibilities: [],
    authority: [],
    knowledge: [],
    decisions: [],
    interactions: [],
    metrics: [],
    completeness: 0,
    maturityScore: null,
    counts: {
      responsibilities: 0,
      authority: 0,
      knowledge: 0,
      decisions: 0,
      interactions: 0,
      metrics: 0,
    },
    summaryCache: null,
    builtAt: null,
    isForming: false,
    ...overrides,
  };
}

describe("RoleMapGrid", () => {
  it("рендерит элементы 6 категорий", () => {
    const map = baseMap({
      responsibilities: [
        {
          id: "re1",
          tenantId: "t1",
          roleId: "r1",
          parentId: null,
          kind: "outcome",
          name: "Рост узнаваемости",
          description: null,
          order: 0,
          sourceBlockIds: [],
          confidence: null,
          createdAt: "2026-06-15T00:00:00.000Z",
          updatedAt: "2026-06-15T00:00:00.000Z",
        },
      ],
      metrics: [
        {
          id: "m1",
          name: "CAC",
          unit: "₽",
          targetValue: 1000,
          currentValue: 1200,
        },
      ],
    });

    render(<RoleMapGrid map={map} />);

    expect(screen.getByText("Обязанности")).toBeInTheDocument();
    expect(screen.getByText("Границы полномочий")).toBeInTheDocument();
    expect(screen.getByText("Требуемые знания")).toBeInTheDocument();
    expect(screen.getByText("Политики решений")).toBeInTheDocument();
    expect(screen.getByText("Взаимодействия")).toBeInTheDocument();
    expect(screen.getByText("KPI и метрики")).toBeInTheDocument();
    expect(screen.getByText("Рост узнаваемости")).toBeInTheDocument();
    expect(screen.getByText("CAC")).toBeInTheDocument();
    expect(screen.getByTestId("role-map-grid")).toBeInTheDocument();
  });

  it("пустые категории показывают подсказку, но карточки остаются", () => {
    render(<RoleMapGrid map={baseMap()} />);
    expect(screen.getByText("Обязанности")).toBeInTheDocument();
    expect(screen.getByText(/Обязанности появятся/)).toBeInTheDocument();
  });
});

describe("isRoleMapEmpty", () => {
  it("true когда все 6 counts = 0", () => {
    expect(isRoleMapEmpty(baseMap())).toBe(true);
  });

  it("false когда есть хотя бы один элемент", () => {
    expect(
      isRoleMapEmpty(
        baseMap({ counts: { ...baseMap().counts, responsibilities: 1 } }),
      ),
    ).toBe(false);
  });
});
