import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const moveMock = vi.fn();
vi.mock("@/api/tracker/issues.api", () => ({
  issuesApi: {
    move: (...args: unknown[]) => moveMock(...args),
    update: vi.fn().mockResolvedValue({ id: "i1" }),
    getByIdentifier: vi.fn().mockResolvedValue({ id: "p2" }),
  },
}));

vi.mock("@/api/tracker/projects.api", () => ({
  projectsApi: { create: vi.fn().mockResolvedValue({ id: "p_new" }) },
}));

const useProjectsMock = vi.fn();
vi.mock("@/hooks/tracker/useProjects", () => ({
  useProjects: (...args: unknown[]) => useProjectsMock(...args),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

vi.mock("./StartMeetingButton", () => ({
  StartMeetingButton: () => null,
}));

import { IssueSidebar } from "./IssueSidebar";
import type { Issue } from "@/domain/tracker";

const ISSUE = {
  id: "i1",
  tenantId: "org_1",
  projectId: "p1",
  identifier: "SRC-7",
  sequenceId: 7,
  title: "Перенести меня",
  description: null,
  descriptionHtml: null,
  descriptionStripped: null,
  priority: "medium",
  stateId: null,
  parentId: null,
  estimatePoints: null,
  sortOrder: 0,
  startDate: null,
  dueDate: null,
  completedAt: null,
  cycleId: null,
  goalId: null,
  boardId: null,
  meetingId: null,
  linkedMeetingIds: [],
  sourceBlockIds: [],
  confidence: null,
  createdManually: true,
  externalSource: null,
  externalId: null,
  entityId: null,
  createdById: "u1",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  archivedAt: null,
  deletedAt: null,
  assigneeUserIds: [],
  labelIds: [],
  childrenCount: null,
  checklistTotalCount: 0,
  checklistDoneCount: 0,
  isOverdue: false,
  isCompleted: false,
  isArchived: false,
} as unknown as Issue;

const PROJECTS = [
  { id: "p1", name: "Исходный", identifier: "SRC" },
  { id: "p2", name: "Целевой", identifier: "DST" },
];

beforeEach(() => {
  moveMock.mockReset().mockResolvedValue({ id: "i1", identifier: "DST-1" });
  toastSuccess.mockReset();
  toastError.mockReset();
  useProjectsMock.mockReset().mockReturnValue({
    projects: PROJECTS,
    total: PROJECTS.length,
    error: null,
    isLoading: false,
    mutate: vi.fn().mockResolvedValue(undefined),
  });
});

describe("IssueSidebar — перенос задачи в другой проект", () => {
  it("показывает имя текущего проекта и кнопку «Перенести»", () => {
    render(<IssueSidebar issue={ISSUE} orgId="org_1" />);
    expect(screen.getByText("Исходный")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Перенести" }),
    ).toBeInTheDocument();
  });

  it("выбор другого проекта вызывает issuesApi.move и onMoved", async () => {
    const onMoved = vi.fn();
    render(<IssueSidebar issue={ISSUE} orgId="org_1" onMoved={onMoved} />);

    fireEvent.click(screen.getByRole("button", { name: "Перенести" }));

    const target = await screen.findByText("Целевой");
    expect(screen.getByText("DST")).toBeInTheDocument();
    expect(screen.queryAllByText("Исходный")).toHaveLength(1);
    fireEvent.click(target);

    await waitFor(() => {
      expect(moveMock).toHaveBeenCalledWith("org_1", "i1", "p2");
    });
    await waitFor(() => {
      expect(onMoved).toHaveBeenCalledTimes(1);
    });
    expect(toastSuccess).toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("ошибка переноса → toast.error через humanizeApiError", async () => {
    moveMock.mockRejectedValueOnce(new Error("boom"));
    const onMoved = vi.fn();
    render(<IssueSidebar issue={ISSUE} orgId="org_1" onMoved={onMoved} />);

    fireEvent.click(screen.getByRole("button", { name: "Перенести" }));
    fireEvent.click(await screen.findByText("Целевой"));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalled();
    });
    expect(onMoved).not.toHaveBeenCalled();
    const msg = String(toastError.mock.calls[0]![0]);
    expect(msg).toContain("Не удалось перенести задачу");
  });
});
