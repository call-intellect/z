import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/hooks/useSubscription", () => ({
  useSubscription: vi.fn(),
}));

import { PaywallGuardButton } from "./PaywallGuardButton";
import { useSubscription } from "@/hooks/useSubscription";

const mockUseSubscription = vi.mocked(useSubscription);

function setMock(opts: { status: string | null; loading?: boolean }) {
  mockUseSubscription.mockReturnValue({
    status: opts.status as never,
    loading: opts.loading ?? false,
    refetch: vi.fn(),
    showPaywallModal: vi.fn(),
    hidePaywallModal: vi.fn(),
    isPaywallModalOpen: false,
  });
}

describe("PaywallGuardButton", () => {
  it("ACTIVE: вызывает onClick как обычная кнопка", () => {
    setMock({ status: "ACTIVE" });
    const onClick = vi.fn();
    render(<PaywallGuardButton onClick={onClick}>Создать</PaywallGuardButton>);
    fireEvent.click(screen.getByText("Создать"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("DEMO: открывает PaywallModal вместо onClick", () => {
    const showPaywallModal = vi.fn();
    mockUseSubscription.mockReturnValue({
      status: "DEMO" as never,
      loading: false,
      refetch: vi.fn(),
      showPaywallModal,
      hidePaywallModal: vi.fn(),
      isPaywallModalOpen: false,
    });
    const onClick = vi.fn();
    render(<PaywallGuardButton onClick={onClick}>Создать</PaywallGuardButton>);
    fireEvent.click(screen.getByText("Создать"));
    expect(onClick).not.toHaveBeenCalled();
    expect(showPaywallModal).toHaveBeenCalledOnce();
  });

  it("SUSPENDED: открывает PaywallModal вместо onClick", () => {
    const showPaywallModal = vi.fn();
    mockUseSubscription.mockReturnValue({
      status: "SUSPENDED" as never,
      loading: false,
      refetch: vi.fn(),
      showPaywallModal,
      hidePaywallModal: vi.fn(),
      isPaywallModalOpen: false,
    });
    const onClick = vi.fn();
    render(<PaywallGuardButton onClick={onClick}>Создать</PaywallGuardButton>);
    fireEvent.click(screen.getByText("Создать"));
    expect(onClick).not.toHaveBeenCalled();
    expect(showPaywallModal).toHaveBeenCalledOnce();
  });

  it("DEMO: ставит data-paywall-readonly + tooltip с reason", () => {
    setMock({ status: "DEMO" });
    render(<PaywallGuardButton>Создать</PaywallGuardButton>);
    const btn = screen.getByText("Создать");
    expect(btn).toHaveAttribute("data-paywall-readonly", "true");
    expect(btn).toHaveAttribute(
      "title",
      "Демо-режим: оплатите подписку, чтобы создавать данные",
    );
  });

  it("ACTIVE: не ставит data-paywall-readonly", () => {
    setMock({ status: "ACTIVE" });
    render(<PaywallGuardButton>Создать</PaywallGuardButton>);
    expect(screen.getByText("Создать")).not.toHaveAttribute(
      "data-paywall-readonly",
    );
  });

  it("loading: disabled", () => {
    setMock({ status: null, loading: true });
    render(<PaywallGuardButton>Создать</PaywallGuardButton>);
    expect(screen.getByText("Создать")).toBeDisabled();
  });
});
