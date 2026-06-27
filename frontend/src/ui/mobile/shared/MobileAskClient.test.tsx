import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let role: "owner" | "admin" | "manager" | "coo" | null = "owner";
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ currentOrgRole: role, currentOrgId: "org-test" }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/chat",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/api/concierge.api", () => ({
  conciergeApi: { askOnce: vi.fn(), undo: vi.fn() },
  conciergeStreamApi: vi.fn(),
}));

vi.mock("@/api/voice.api", () => ({
  voiceApi: { transcribe: vi.fn(), synthesize: vi.fn() },
}));

import { MobileAskClient } from "./MobileAskClient";

afterEach(() => {
  vi.clearAllMocks();
  role = "owner";
});

describe("MobileAskClient", () => {
  it("(а) exec-роль (owner) — отрендерены exec-промпты", () => {
    role = "owner";
    render(<MobileAskClient />);
    expect(screen.getByText("Спросить")).toBeInTheDocument();
    expect(screen.getByText("Сводка за неделю")).toBeInTheDocument();
    expect(screen.getByText("Риски по проекту")).toBeInTheDocument();
    expect(screen.getByText("Кому помочь с обещаниями")).toBeInTheDocument();
  });

  it("(б) тап по промпт-кнопке подставляет текст в поле ввода", () => {
    role = "owner";
    render(<MobileAskClient />);
    const chip = screen.getByText("Риски по проекту");
    fireEvent.click(chip);
    const field = screen.getByPlaceholderText(
      "Спросите Кору о памяти компании…",
    ) as HTMLInputElement;
    expect(field.value).toBe("Риски по проекту");
  });

  it("(в) manager-роль — manager-промпты, нет exec-набора", () => {
    role = "manager";
    render(<MobileAskClient />);
    expect(screen.getByText("Как у нас оформляют…")).toBeInTheDocument();
    expect(screen.getByText("Спросить клон должности")).toBeInTheDocument();
    expect(screen.queryByText("Сводка за неделю")).toBeNull();
  });

  it("(г) Р8 — нет озвучки/TTS в DOM", () => {
    role = "owner";
    const { container } = render(<MobileAskClient />);
    expect(container.textContent ?? "").not.toMatch(/🔊|Слушать|voiceMode/i);
  });
});
