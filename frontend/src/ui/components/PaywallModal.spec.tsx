import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: Record<string, unknown>) => (
    <a {...props}>{children as string}</a>
  ),
}));

vi.mock("@/hooks/useSubscription", () => ({
  useSubscription: vi.fn(),
}));

import { PaywallModal } from "./PaywallModal";
import { useSubscription } from "@/hooks/useSubscription";

const mockUseSubscription = vi.mocked(useSubscription);

function setMock(opts: { open: boolean; onHide?: () => void }) {
  const hide = opts.onHide ?? vi.fn();
  mockUseSubscription.mockReturnValue({
    status: null,
    loading: false,
    refetch: vi.fn(),
    showPaywallModal: vi.fn(),
    hidePaywallModal: hide,
    isPaywallModalOpen: opts.open,
  });
  return hide;
}

describe("PaywallModal", () => {
  it("рендерится при isPaywallModalOpen=true", () => {
    setMock({ open: true });
    render(<PaywallModal />);
    expect(screen.getByText("Оплатите подписку")).toBeInTheDocument();
  });

  it("скрывается при isPaywallModalOpen=false", () => {
    setMock({ open: false });
    render(<PaywallModal />);
    expect(screen.queryByText("Оплатите подписку")).not.toBeInTheDocument();
  });

  it("содержит список возможностей", () => {
    setMock({ open: true });
    render(<PaywallModal />);
    expect(screen.getByText("150 видеовстреч в месяц")).toBeInTheDocument();
    expect(screen.getByText("31 место для пользователей")).toBeInTheDocument();
    expect(screen.getByText("Отчёты Коры и граф знаний")).toBeInTheDocument();
  });

  it("обе кнопки ведут на /settings/subscription", () => {
    setMock({ open: true });
    render(<PaywallModal />);
    const cardBtn = screen.getByTestId("paywall-card-btn");
    const invoiceBtn = screen.getByTestId("paywall-invoice-btn");
    expect(cardBtn.closest("a")).toHaveAttribute(
      "href",
      "/settings/subscription",
    );
    expect(invoiceBtn.closest("a")).toHaveAttribute(
      "href",
      "/settings/subscription",
    );
  });

  it("показывает цену и подпись про доп. места", () => {
    setMock({ open: true });
    render(<PaywallModal />);
    expect(screen.getByText("60 000 ₽/мес")).toBeInTheDocument();
    expect(
      screen.getByText("или 576 000 ₽/год (скидка 20%)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Доп. места: +1 000 ₽/мес за каждого пользователя сверх 31",
      ),
    ).toBeInTheDocument();
  });
});
