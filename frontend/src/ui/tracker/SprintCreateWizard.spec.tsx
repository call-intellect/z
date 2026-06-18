import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { SprintCreateWizard } from "./SprintCreateWizard";

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ currentOrgId: "org_test", isLoading: false }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/hooks/tracker/useProjects", () => ({
  useProjects: () => ({ projects: [], isLoading: false, mutate: vi.fn() }),
}));
vi.mock("@/hooks/useVendors", () => ({
  useVendors: () => ({ vendors: [], isLoading: false, mutate: vi.fn() }),
}));
vi.mock("@/hooks/useCards", () => ({
  useCards: () => ({ cards: [], isLoading: false, mutate: vi.fn() }),
}));
vi.mock("@/hooks/useDepartments", () => ({
  useDepartments: () => ({
    departments: [],
    isLoading: false,
    mutate: vi.fn(),
  }),
}));
vi.mock("@/hooks/useRoles", () => ({
  useRoles: () => ({ roles: [], isLoading: false, mutate: vi.fn() }),
}));
vi.mock("@/hooks/usePersons", () => ({
  usePersons: () => ({ persons: [], isLoading: false, mutate: vi.fn() }),
}));

vi.mock("@/api/vendors.api", () => ({ vendorsApi: { create: vi.fn() } }));
vi.mock("@/api/cards.api", () => ({ cardsApi: { create: vi.fn() } }));
vi.mock("@/api/structure.api", () => ({
  departmentsApi: { create: vi.fn() },
  personsDomainApi: { create: vi.fn() },
}));
vi.mock("@/api/sprints.api", () => ({
  sprintsListApi: { quickCreate: vi.fn() },
}));

function renderWizard() {
  return render(
    <SprintCreateWizard open onClose={vi.fn()} onCreated={vi.fn()} />,
  );
}

describe("SprintCreateWizard — шаг scope", () => {
  it("рендерит 6 radio-вариантов привязки", () => {
    renderWizard();
    expect(
      screen.getByRole("radio", { name: /Компания/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Отдел/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Клиент/i })).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /Поставщик/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /Сотрудник/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Проект/i })).toBeInTheDocument();
  });

  it("по умолчанию scope=org и кнопка «Далее» активна", () => {
    renderWizard();
    const orgRadio = screen.getByRole("radio", { name: /Компания/i });
    expect(orgRadio).toHaveAttribute("aria-checked", "true");

    const nextBtn = screen.getByRole("button", { name: /Далее/i });
    expect(nextBtn).not.toBeDisabled();
  });

  it('показывает группу radio с aria-label="Привязка спринта"', () => {
    renderWizard();
    expect(
      screen.getByRole("radiogroup", { name: /Привязка спринта/i }),
    ).toBeInTheDocument();
  });
});
