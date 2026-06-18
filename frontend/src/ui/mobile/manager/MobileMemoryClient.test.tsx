import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DecisionListItemApi } from "@/api/decisions.api";
import { MobileMemoryClient } from "./MobileMemoryClient";

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ currentOrgId: "org-test" }),
}));

const listMock = vi.fn();
vi.mock("@/api/decisions.api", () => ({
  decisionsApi: { list: (...args: unknown[]) => listMock(...args) },
}));

vi.mock("swr", () => {
  const React = require("react") as typeof import("react");
  function useFakeSwr(key: unknown, fetcher: (k: unknown) => Promise<unknown>) {
    const [state, setState] = React.useState({
      data: undefined as unknown,
      error: undefined as unknown,
      isLoading: !!key,
    });
    const keyStr = JSON.stringify(key);
    React.useEffect(() => {
      if (!key || !fetcher) return;
      let alive = true;
      Promise.resolve(fetcher(key)).then(
        (data) =>
          alive && setState({ data, error: undefined, isLoading: false }),
        (error) =>
          alive && setState({ data: undefined, error, isLoading: false }),
      );
      return () => {
        alive = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [keyStr]);
    return state;
  }
  return { __esModule: true, default: useFakeSwr };
});

function apiItem(over: Partial<DecisionListItemApi> = {}): DecisionListItemApi {
  return {
    id: "d1",
    statement: "Переходим на недельные спринты",
    status: "approved",
    decidedByPersonIds: [],
    decidedAt: "2026-06-11T10:00:00Z",
    deadline: null,
    supersedesId: null,
    affectsEntityIds: [],
    confidence: null,
    trustTier: "human",
    updatedAt: "2026-06-11T10:00:00Z",
    createdAt: "2026-05-01T08:00:00Z",
    ...over,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

beforeEach(() => {
  listMock.mockResolvedValue({
    items: [apiItem()],
    total: 1,
    page: 1,
    limit: 20,
    totalPages: 1,
  });
});

describe("MobileMemoryClient", () => {
  it("рендерит ленту: тег «Решение», заголовок и статус", async () => {
    render(<MobileMemoryClient />);

    expect(
      await screen.findByText("Переходим на недельные спринты"),
    ).toBeInTheDocument();
    expect(screen.getByText("Решение")).toBeInTheDocument();
    expect(screen.getByText("Принятое")).toBeInTheDocument();
    expect(listMock).toHaveBeenCalledWith({ limit: 20 });
  });

  it("пусто без поиска → «Память пока пуста»", async () => {
    listMock.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });
    render(<MobileMemoryClient />);

    expect(await screen.findByText("Память пока пуста")).toBeInTheDocument();
  });

  it("ввод в поиск меняет запрос (q) и показывает «Ничего не нашлось» при пустой выдаче", async () => {
    const user = userEvent.setup();
    render(<MobileMemoryClient />);
    await screen.findByText("Переходим на недельные спринты");

    listMock.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });

    const input = screen.getByLabelText("Поиск по решениям");
    await user.type(input, "спринт");

    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith({ q: "спринт", limit: 20 }),
    );
    expect(await screen.findByText("Ничего не нашлось")).toBeInTheDocument();
  });
});
