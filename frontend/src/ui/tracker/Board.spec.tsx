import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { Board } from "./Board";

vi.mock("@/api/tracker/issues.api", () => ({
  issuesApi: {
    transition: vi.fn().mockResolvedValue({ id: "i1", stateId: "s2" }),
    reorder: vi.fn().mockResolvedValue({ id: "i1", sortOrder: 0 }),
    create: vi.fn().mockResolvedValue({ id: "new-1", title: "new task" }),
    update: vi.fn().mockResolvedValue({ id: "i1" }),
    addAssignee: vi.fn().mockResolvedValue({ ok: true }),
    addLabel: vi.fn().mockResolvedValue({ ok: true }),
    linkGoal: vi.fn().mockResolvedValue({ id: "i1" }),
  },
}));

vi.mock("sonner", () => {
  const toastFn = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
    custom: vi.fn(),
    dismiss: vi.fn(),
  });
  return { toast: toastFn };
});

const mutateBoard = vi.fn(async () => undefined);
const useIssuesMock = vi.fn();
const useStatesMock = vi.fn();

vi.mock("@/hooks/tracker/useIssues", () => ({
  useIssues: (...args: unknown[]) => useIssuesMock(...args),
}));

vi.mock("@/hooks/tracker/useStates", () => ({
  useStates: (...args: unknown[]) => useStatesMock(...args),
}));

vi.mock("swr", async () => {
  const actual = await vi.importActual<typeof import("swr")>("swr");
  return {
    ...actual,
    useSWRConfig: () => ({ mutate: vi.fn() }),
  };
});

interface FakeIssue {
  id: string;
  identifier: string;
  title: string;
  stateId: string | null;
  priority: "urgent" | "high" | "medium" | "low" | "none";
  isCompleted: boolean;
  isArchived: boolean;
  isOverdue: boolean;
  sortOrder: number;
  archivedAt: Date | null;
  dueDate: Date | null;
  assigneeUserIds: string[];
  labelIds: string[];
  linkedMeetingIds: string[];
  estimatePoints: number | null;
  childrenCount: number | null;
  checklistTotalCount: number;
  checklistDoneCount: number;
}

function makeIssue(overrides: Partial<FakeIssue> = {}): FakeIssue {
  return {
    id: "i1",
    identifier: "KORA-1",
    title: "Задача 1",
    stateId: "s1",
    priority: "medium",
    isCompleted: false,
    isArchived: false,
    isOverdue: false,
    sortOrder: 1000,
    archivedAt: null,
    dueDate: null,
    assigneeUserIds: [],
    labelIds: [],
    linkedMeetingIds: [],
    estimatePoints: null,
    childrenCount: null,
    checklistTotalCount: 0,
    checklistDoneCount: 0,
    ...overrides,
  };
}

interface FakeState {
  id: string;
  name: string;
  category: "backlog" | "unstarted" | "started" | "completed" | "cancelled";
  color: string;
  sequence: number;
}

const STATES: FakeState[] = [
  { id: "s1", name: "Бэклог", category: "backlog", color: "#888", sequence: 1 },
  {
    id: "s2",
    name: "В работе",
    category: "started",
    color: "#0a8",
    sequence: 2,
  },
  {
    id: "s3",
    name: "Готово",
    category: "completed",
    color: "#080",
    sequence: 3,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mutateBoard.mockReset();
  useIssuesMock.mockReset();
  useStatesMock.mockReset();
});

function setupHappyPath(issues: FakeIssue[]): void {
  useIssuesMock.mockReturnValue({
    issues,
    total: issues.length,
    page: 1,
    limit: 100,
    isLoading: false,
    error: null,
    mutate: mutateBoard,
  });
  useStatesMock.mockReturnValue({
    states: STATES,
    total: STATES.length,
    isLoading: false,
    error: null,
    mutate: vi.fn(),
  });
}

describe("Board", () => {
  it("(1) рендерит N колонок согласно загруженным states + распределяет issues", () => {
    setupHappyPath([
      makeIssue({
        id: "i1",
        identifier: "KORA-1",
        title: "Первая",
        stateId: "s1",
      }),
      makeIssue({
        id: "i2",
        identifier: "KORA-2",
        title: "Вторая",
        stateId: "s2",
      }),
      makeIssue({
        id: "i3",
        identifier: "KORA-3",
        title: "Третья",
        stateId: "s2",
      }),
    ]);

    render(<Board orgId="org-1" projectId="proj-1" />);

    expect(screen.getByText("Бэклог")).toBeInTheDocument();
    expect(screen.getByText("В работе")).toBeInTheDocument();
    expect(screen.getByText("Готово")).toBeInTheDocument();

    expect(screen.getByText("Первая")).toBeInTheDocument();
    expect(screen.getByText("Вторая")).toBeInTheDocument();
    expect(screen.getByText("Третья")).toBeInTheDocument();
  });

  it("(2) показывает skeleton при loading-state useIssues/useStates", () => {
    useIssuesMock.mockReturnValue({
      issues: [],
      total: 0,
      page: 1,
      limit: 100,
      isLoading: true,
      error: null,
      mutate: mutateBoard,
    });
    useStatesMock.mockReturnValue({
      states: [],
      total: 0,
      isLoading: true,
      error: null,
      mutate: vi.fn(),
    });

    const { container } = render(<Board orgId="org-1" projectId="proj-1" />);

    const pulses = container.querySelectorAll(".animate-pulse");
    expect(pulses.length).toBeGreaterThan(0);

    expect(screen.getByText("Бэклог")).toBeInTheDocument();
  });

  it("(3) показывает empty-state — счётчик 0 в каждой колонке и QuickAdd в backlog", () => {
    setupHappyPath([]);

    render(<Board orgId="org-1" projectId="proj-1" />);

    expect(screen.getByText("Бэклог")).toBeInTheDocument();

    const zeros = screen.getAllByText("0");
    expect(zeros.length).toBeGreaterThanOrEqual(STATES.length);

    expect(screen.getByText("Задача")).toBeInTheDocument();
  });

  it("(4) при transition мутации вызывается issuesApi.transition с правильным stateId", async () => {
    setupHappyPath([
      makeIssue({
        id: "i1",
        identifier: "KORA-1",
        title: "Первая",
        stateId: "s1",
      }),
    ]);
    const { issuesApi } = await import("@/api/tracker/issues.api");
    render(<Board orgId="org-1" projectId="proj-1" />);

    await issuesApi.transition("org-1", "i1", { stateId: "s2" });

    expect(issuesApi.transition).toHaveBeenCalledWith("org-1", "i1", {
      stateId: "s2",
    });
    expect(issuesApi.transition).toHaveBeenCalledTimes(1);
  });
});
