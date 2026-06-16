import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  peopleAtRiskFromApi,
  type PeopleAtRiskResponseApi,
} from "@/domain/people-at-risk";
import { PeopleAtRiskWidget } from "./PeopleAtRiskWidget";

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ currentOrgId: "org-test", user: null, isLoading: false }),
}));

vi.mock("@/api/dashboard.api", () => ({
  dashboardApi: { peopleAtRisk: vi.fn() },
}));

const swrImpl = vi.fn();
vi.mock("swr", () => ({
  __esModule: true,
  default: (...args: unknown[]) => swrImpl(...args),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const RESPONSE: PeopleAtRiskResponseApi = {
  items: [
    {
      personId: "p1",
      name: "Иван Петров",
      department: "Продажи",
      pulseScore: 30,
      topReason: "Признаки перегрузки — обсудите нагрузку",
      engagementScoreAt: "2026-06-05T10:00:00.000Z",
    },
  ],
  totalAtRisk: 1,
  generatedAt: "2026-06-05T10:00:00.000Z",
};

describe("peopleAtRiskFromApi", () => {
  it("pass-through всех полей строки и метаданных", () => {
    const domain = peopleAtRiskFromApi(RESPONSE);
    expect(domain.totalAtRisk).toBe(1);
    expect(domain.generatedAt).toBe("2026-06-05T10:00:00.000Z");
    expect(domain.items).toHaveLength(1);
    expect(domain.items[0]).toEqual({
      personId: "p1",
      name: "Иван Петров",
      department: "Продажи",
      pulseScore: 30,
      topReason: "Признаки перегрузки — обсудите нагрузку",
      engagementScoreAt: "2026-06-05T10:00:00.000Z",
    });
  });

  it("сохраняет null в department / engagementScoreAt", () => {
    const domain = peopleAtRiskFromApi({
      items: [
        {
          personId: "p2",
          name: "Без Отдела",
          department: null,
          pulseScore: 55,
          topReason: "Низкая вовлечённость — назначьте 1:1",
          engagementScoreAt: null,
        },
      ],
      totalAtRisk: 1,
      generatedAt: "x",
    });
    expect(domain.items[0]!.department).toBeNull();
    expect(domain.items[0]!.engagementScoreAt).toBeNull();
  });
});

describe("PeopleAtRiskWidget", () => {
  it("рендерит фразу-действие topReason; число присутствует, но не доминирует", () => {
    swrImpl.mockReturnValue({
      data: peopleAtRiskFromApi(RESPONSE),
      error: undefined,
      isLoading: false,
    });
    render(<PeopleAtRiskWidget />);

    expect(
      screen.getByText("Признаки перегрузки — обсудите нагрузку"),
    ).toBeInTheDocument();
    expect(screen.getByText("Иван Петров")).toBeInTheDocument();
    expect(screen.getByText("Продажи")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
    expect(
      screen.getByLabelText(
        "Иван Петров: Признаки перегрузки — обсудите нагрузку",
      ),
    ).toBeInTheDocument();
  });

  it("пустой список → success-state «Все сотрудники в норме…»", () => {
    swrImpl.mockReturnValue({
      data: { items: [], totalAtRisk: 0, generatedAt: "x" },
      error: undefined,
      isLoading: false,
    });
    render(<PeopleAtRiskWidget />);
    expect(screen.getByText(/Все сотрудники в норме/)).toBeInTheDocument();
  });

  it("загрузка → скелетон, заголовок виден, не падает", () => {
    swrImpl.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
    });
    const { container } = render(<PeopleAtRiskWidget />);
    expect(screen.getByText("Сотрудники под риском")).toBeInTheDocument();
    expect(container.querySelector("a")).toBeNull();
  });

  it("ошибка → виджет скрыт (null)", () => {
    swrImpl.mockReturnValue({
      data: undefined,
      error: new Error("boom"),
      isLoading: false,
    });
    const { container } = render(<PeopleAtRiskWidget />);
    expect(container.firstChild).toBeNull();
  });
});
