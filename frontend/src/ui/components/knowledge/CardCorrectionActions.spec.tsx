import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

import { CardCorrectionActions } from "./CardCorrectionActions";

const baseFields = [
  { key: "name", label: "Название", value: "Старое название" },
  { key: "statement", label: "Суть", value: "Суть", multiline: true },
];

describe("CardCorrectionActions", () => {
  it("клик «Исправить» открывает форму с предзаполненными значениями", async () => {
    const user = userEvent.setup();
    render(
      <CardCorrectionActions
        fields={baseFields}
        canApplyDirectly={false}
        onCorrect={vi.fn()}
        onDispute={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Исправить/ }));

    const nameInput = screen.getByLabelText("Название") as HTMLInputElement;
    expect(nameInput.value).toBe("Старое название");
  });

  it("подпись confirm зависит от canApplyDirectly", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <CardCorrectionActions
        fields={baseFields}
        canApplyDirectly
        onCorrect={vi.fn()}
        onDispute={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Исправить/ }));
    expect(
      screen.getByRole("button", { name: "Сохранить как проверенную версию" }),
    ).toBeInTheDocument();

    rerender(
      <CardCorrectionActions
        fields={baseFields}
        canApplyDirectly={false}
        onCorrect={vi.fn()}
        onDispute={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Предложить правку" }),
    ).toBeInTheDocument();
  });

  it("submit изменённого поля вызывает onCorrect с changed-полями и шлёт success-тост", async () => {
    const user = userEvent.setup();
    const onCorrect = vi.fn().mockResolvedValue({ applied: true });
    render(
      <CardCorrectionActions
        fields={baseFields}
        canApplyDirectly
        onCorrect={onCorrect}
        onDispute={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Исправить/ }));
    const nameInput = screen.getByLabelText("Название");
    await user.clear(nameInput);
    await user.type(nameInput, "Новое название");
    await user.click(
      screen.getByRole("button", { name: "Сохранить как проверенную версию" }),
    );

    await waitFor(() => expect(onCorrect).toHaveBeenCalledTimes(1));
    expect(onCorrect).toHaveBeenCalledWith(
      { name: "Новое название" },
      undefined,
    );
    expect(toastSuccess).toHaveBeenCalledWith(
      "Карточка обновлена — теперь она проверена человеком",
    );
  });
});
