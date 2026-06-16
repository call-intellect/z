import { describe, expect, it, vi, beforeEach, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ForceStatusDialog } from "./ForceStatusDialog";

beforeAll(() => {
  const g = globalThis as unknown as {
    ResizeObserver?: unknown;
  };
  if (typeof g.ResizeObserver === "undefined") {
    g.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  const proto = Element.prototype as unknown as {
    hasPointerCapture?: (id: number) => boolean;
    releasePointerCapture?: (id: number) => void;
    setPointerCapture?: (id: number) => void;
    scrollIntoView?: () => void;
  };
  if (typeof proto.hasPointerCapture !== "function") {
    proto.hasPointerCapture = () => false;
  }
  if (typeof proto.releasePointerCapture !== "function") {
    proto.releasePointerCapture = () => {};
  }
  if (typeof proto.setPointerCapture !== "function") {
    proto.setPointerCapture = () => {};
  }
  if (typeof proto.scrollIntoView !== "function") {
    proto.scrollIntoView = () => {};
  }
});

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const adminForceStatus = vi.fn();
vi.mock("@/api/billing.api", () => ({
  billingApi: {
    adminForceStatus: (...args: unknown[]) => adminForceStatus(...args),
  },
}));

function setup(overrides?: Partial<Parameters<typeof ForceStatusDialog>[0]>) {
  const onOpenChange = vi.fn();
  const onSuccess = vi.fn();
  const utils = render(
    <ForceStatusDialog
      open={true}
      onOpenChange={onOpenChange}
      tenantId="org-1"
      currentStatus="ACTIVE"
      onSuccess={onSuccess}
      {...overrides}
    />,
  );
  return { onOpenChange, onSuccess, ...utils };
}

describe("ForceStatusDialog", () => {
  beforeEach(() => {
    adminForceStatus.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it("submit disabled пока статус не изменён (даже с reason и checkbox)", async () => {
    const user = userEvent.setup();
    setup({ currentStatus: "ACTIVE" });

    await user.type(screen.getByLabelText(/Причина/i), "обоснование");
    await user.click(
      screen.getByRole("checkbox", {
        name: /Я понимаю, что обхожу FSM/i,
      }),
    );

    expect(
      screen.getByRole("button", { name: "Сменить статус" }),
    ).toBeDisabled();
  });

  it("submit disabled без checkbox даже с reason ≥3 и сменой статуса", async () => {
    const user = userEvent.setup();
    setup({ currentStatus: "ACTIVE" });

    await user.click(
      screen.getByRole("combobox", { name: /Новый статус подписки/i }),
    );
    await user.click(screen.getByRole("option", { name: /Приостановлена/i }));
    await user.type(screen.getByLabelText(/Причина/i), "обоснование длинное");

    expect(
      screen.getByRole("button", { name: "Сменить статус" }),
    ).toBeDisabled();
  });

  it("успешный submit: статус + reason ≥3 + checkbox → API + onSuccess", async () => {
    const user = userEvent.setup();
    adminForceStatus.mockResolvedValue({ status: "SUSPENDED" });
    const { onSuccess } = setup({ currentStatus: "ACTIVE" });

    await user.click(
      screen.getByRole("combobox", { name: /Новый статус подписки/i }),
    );
    await user.click(screen.getByRole("option", { name: /Приостановлена/i }));
    await user.type(screen.getByLabelText(/Причина/i), "  тикет 999  ");
    await user.click(
      screen.getByRole("checkbox", {
        name: /Я понимаю, что обхожу FSM/i,
      }),
    );

    const submit = screen.getByRole("button", { name: "Сменить статус" });
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(adminForceStatus).toHaveBeenCalledWith("org-1", {
      newStatus: "SUSPENDED",
      reason: "тикет 999",
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalled();
  });
});
