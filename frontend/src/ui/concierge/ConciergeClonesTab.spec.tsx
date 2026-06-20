import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import type { CloneListItemApi } from "@/api/clones.api";

const listClonesMock = vi.fn();

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ currentOrgId: "org-1" }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/api/clones.api", () => ({
  clonesApi: {
    listClones: (...args: unknown[]) => listClonesMock(...args),
  },
}));

import { ConciergeClonesTab } from "./ConciergeClonesTab";

function makeClone(id: string, confidence: number): CloneListItemApi {
  return {
    personaId: `persona-${id}`,
    roleId: `role-${id}`,
    roleName: `Роль ${id}`,
    departmentName: null,
    departmentId: null,
    version: 1,
    publicName: `Клон ${id}`,
    status: "active",
    currentBearer: null,
    confidence,
    traitsCount: 0,
    lastBuildAt: new Date().toISOString(),
  };
}

describe("ConciergeClonesTab", () => {
  beforeEach(() => {
    listClonesMock.mockReset();
  });

  it("рендерит 4 карточки из 10 клонов и ссылку «Все клоны»", async () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      makeClone(String(i), i / 10),
    );
    listClonesMock.mockResolvedValue({
      items,
      total: items.length,
      page: 1,
      pageSize: 100,
    });

    render(<ConciergeClonesTab />);

    await waitFor(() => {
      expect(screen.getByText("Клон 9")).toBeInTheDocument();
    });

    const rendered = items
      .map((c) => c.publicName)
      .filter((name) => screen.queryByText(name));
    expect(rendered).toHaveLength(4);
    expect(rendered.sort()).toEqual(
      ["Клон 6", "Клон 7", "Клон 8", "Клон 9"].sort(),
    );

    const cardOrder = screen
      .getAllByRole("button")
      .map((b) => b.querySelector("span")?.textContent)
      .filter((t): t is string => Boolean(t));
    expect(cardOrder).toEqual(["Клон 9", "Клон 8", "Клон 7", "Клон 6"]);

    expect(screen.getByText("Все клоны")).toBeInTheDocument();
  });
});
