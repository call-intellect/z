import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ currentOrgId: "org-test", isLoading: false }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/api/probe-voice.api", () => ({
  transcribeProbeAnswer: vi.fn(),
}));

import { ProbeAnswerInput } from "./ProbeAnswerInput";

describe("ProbeAnswerInput", () => {
  it("1. рендерит вопрос, textarea и переключатели; пустая отправка disabled", () => {
    render(
      <ProbeAnswerInput question="Кто отвечает за релиз?" onSubmit={vi.fn()} />,
    );

    expect(screen.getByText("Кто отвечает за релиз?")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Ответьте своими словами…"),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Текст/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Голос/ })).toBeInTheDocument();

    const submit = screen.getByRole("button", { name: /Отправить/ });
    expect(submit).toBeDisabled();
  });

  it("2. ввод текста и клик «Отправить» вызывает onSubmit с trim-значением", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <ProbeAnswerInput question="Какой статус OKR?" onSubmit={onSubmit} />,
    );

    const textarea = screen.getByPlaceholderText("Ответьте своими словами…");
    fireEvent.change(textarea, {
      target: { value: "  Зелёный, идём по плану  " },
    });

    const submit = screen.getByRole("button", { name: /Отправить/ });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);

    await Promise.resolve();
    expect(onSubmit).toHaveBeenCalledWith("Зелёный, идём по плану");
  });

  it("3. voiceEnabled=false → переключатели режима не рендерятся", () => {
    render(
      <ProbeAnswerInput
        question="Тестовый вопрос?"
        onSubmit={vi.fn()}
        voiceEnabled={false}
      />,
    );

    expect(
      screen.queryByRole("tab", { name: /Текст/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: /Голос/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Ответьте своими словами…"),
    ).toBeInTheDocument();
  });

  it("4. isSubmitting=true → кнопка «Отправить» disabled со спиннером", () => {
    render(
      <ProbeAnswerInput
        question="Тестовый вопрос?"
        onSubmit={vi.fn()}
        isSubmitting
      />,
    );

    const textarea = screen.getByPlaceholderText("Ответьте своими словами…");
    fireEvent.change(textarea, { target: { value: "есть ответ" } });

    const submit = screen.getByRole("button", { name: /Отправить/ });
    expect(submit).toBeDisabled();
    expect(submit.querySelector(".animate-spin")).not.toBeNull();
  });
});
