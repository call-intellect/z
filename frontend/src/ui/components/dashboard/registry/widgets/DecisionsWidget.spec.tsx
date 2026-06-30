import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DecisionsWidget } from "./DecisionsWidget";

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ currentOrgId: "org-test", user: null, isLoading: false }),
}));

vi.mock("@/api/operations-dashboard.api", () => ({
  operationsDashboardApi: {
    getDecisionThroughput: vi.fn(),
    getStalledDecisions: vi.fn(),
  },
}));

const swrImpl = vi.fn();
vi.mock("swr", () => ({
  __esModule: true,
  default: (...args: unknown[]) => swrImpl(...args),
}));

afterEach(() => {
  vi.clearAllMocks();
});

function keyHead(args: unknown[]): string | null {
  const key = args[0];
  if (Array.isArray(key)) return String(key[0]);
  return null;
}

function bindSwr(opts: {
  throughput: unknown;
  stalled: unknown;
}): void {
  swrImpl.mockImplementation((...args: unknown[]) => {
    const head = keyHead(args);
    if (head === "decisions-throughput") {
      return { data: opts.throughput, error: undefined, isLoading: false };
    }
    if (head === "decisions-stalled") {
      return { data: opts.stalled, error: undefined, isLoading: false };
    }
    return { data: undefined, error: undefined, isLoading: false };
  });
}

const STALLED_TWO = {
  items: [
    { id: "d1", statement: "Перейти на новый стек", ageDays: 5 },
    { id: "d2", statement: "Закрыть старый сервис", ageDays: 9 },
  ],
};

const THROUGHPUT = {
  total: 4,
  doneWithOutcomes: 2,
  throughputPercent: 50,
};

describe("DecisionsWidget — ежедневный ритм (today)", () => {
  it("показывает индикатор-утечку и ссылку, без очереди-списка и throughput", () => {
    bindSwr({ throughput: undefined, stalled: STALLED_TWO });
    render(<DecisionsWidget rhythm="today" />);

    expect(screen.getByText("Решения без действия")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Смотреть решения")).toBeInTheDocument();

    expect(screen.queryByText("Перейти на новый стек")).not.toBeInTheDocument();
    expect(screen.queryByText(/Доведено:/)).not.toBeInTheDocument();
    expect(screen.queryByText("Застряли без результата")).not.toBeInTheDocument();
  });

  it("нет застрявших → спокойное состояние «Все решения в работе», без алярма", () => {
    bindSwr({ throughput: undefined, stalled: { items: [] } });
    render(<DecisionsWidget rhythm="today" />);

    expect(screen.getByText(/Все решения в работе/)).toBeInTheDocument();
    expect(screen.queryByText("Решения без действия")).not.toBeInTheDocument();
  });
});

describe("DecisionsWidget — недельный ритм (week)", () => {
  it("показывает throughput и очередь-список застрявших решений", () => {
    bindSwr({ throughput: THROUGHPUT, stalled: STALLED_TWO });
    render(<DecisionsWidget rhythm="week" />);

    expect(screen.getByText(/Доведено:/)).toBeInTheDocument();
    expect(screen.getByText("Застряли без результата")).toBeInTheDocument();
    expect(screen.getByText("Перейти на новый стек")).toBeInTheDocument();
    expect(screen.getByText("Закрыть старый сервис")).toBeInTheDocument();
  });
});
