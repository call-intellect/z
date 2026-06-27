import { describe, expect, it, vi, beforeEach, beforeAll } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";

import type {
  ConciergePostMessageBody,
  ConciergeStreamEvent,
} from "@/api/concierge.api";

const streamMock = vi.fn();
const askOnceMock = vi.fn();
const undoMock = vi.fn();
const transcribeMock = vi.fn();
const synthesizeMock = vi.fn();

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ currentOrgId: "org-1" }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/api/concierge.api", () => ({
  conciergeStreamApi: (body: ConciergePostMessageBody, signal?: AbortSignal) =>
    streamMock(body, signal),
  conciergeApi: {
    askOnce: (...args: unknown[]) => askOnceMock(...args),
    undo: (...args: unknown[]) => undoMock(...args),
  },
}));

vi.mock("@/api/voice.api", () => ({
  voiceApi: {
    transcribe: (...args: unknown[]) => transcribeMock(...args),
    synthesize: (...args: unknown[]) => synthesizeMock(...args),
  },
}));

vi.mock("@/api/tables.api", () => ({
  tablesApi: { createFromSchema: vi.fn() },
}));

import { MasterScopedChat } from "./MasterScopedChat";

async function* makeStream(
  events: ConciergeStreamEvent[],
): AsyncGenerator<ConciergeStreamEvent> {
  for (const ev of events) {
    yield ev;
  }
}

class FakeMediaRecorder {
  static isTypeSupported(): boolean {
    return false;
  }
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((ev: unknown) => void) | null = null;
  onstop: (() => void) | null = null;
  start(): void {
    this.state = "recording";
  }
  stop(): void {
    this.state = "inactive";
  }
}

describe("MasterScopedChat", () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, "MediaRecorder", {
      value: FakeMediaRecorder,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn() },
      writable: true,
      configurable: true,
    });
  });

  beforeEach(() => {
    streamMock.mockReset();
    askOnceMock.mockReset();
  });

  it("рендерит пустое состояние и поле ввода", () => {
    render(
      <MasterScopedChat
        scope="issue"
        scopeRefId="issue-1"
        orgId="org-1"
        emptyTitle="Спросите Кору про эту задачу"
        emptyHint="Подтянет контекст."
      />,
    );

    expect(
      screen.getByText("Спросите Кору про эту задачу"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Вопрос к Коре")).toBeInTheDocument();
    expect(screen.getByLabelText("Отправить вопрос")).toBeInTheDocument();
  });

  it("рендерит чипы подсказок и подставляет текст в поле по клику", () => {
    render(
      <MasterScopedChat
        scope="org"
        orgId="org-1"
        suggestedPrompts={["Сводка за неделю"]}
      />,
    );

    const chip = screen.getByRole("button", { name: "Сводка за неделю" });
    expect(chip).toBeInTheDocument();
    fireEvent.click(chip);
    expect(screen.getByLabelText("Вопрос к Коре")).toHaveValue(
      "Сводка за неделю",
    );
  });

  it("показывает кнопку микрофона при enableVoice", () => {
    render(
      <MasterScopedChat
        scope="issue"
        scopeRefId="issue-1"
        orgId="org-1"
        enableVoice
      />,
    );

    expect(screen.getByLabelText("Записать голос")).toBeInTheDocument();
  });

  it("передаёт scope/scopeRefId в тело concierge и рендерит ответ с цитатой", async () => {
    streamMock.mockImplementation((_body: ConciergePostMessageBody) =>
      makeStream([
        { type: "started", conversationId: "conv-1" },
        {
          type: "message",
          text: "Ответ Мастера",
          citations: [
            {
              meetingId: "m-1",
              meetingTitle: "Планёрка",
              startMs: 1000,
              endMs: 2000,
              snippet: "фрагмент",
            },
          ],
        },
        { type: "done", messageId: "msg-1" },
      ]),
    );

    render(
      <MasterScopedChat scope="issue" scopeRefId="issue-1" orgId="org-1" />,
    );

    fireEvent.change(screen.getByLabelText("Вопрос к Коре"), {
      target: { value: "Что по задаче?" },
    });
    fireEvent.click(screen.getByLabelText("Отправить вопрос"));

    await waitFor(() => {
      expect(screen.getByText("Ответ Мастера")).toBeInTheDocument();
    });

    expect(streamMock).toHaveBeenCalledTimes(1);
    const body = streamMock.mock.calls[0][0] as ConciergePostMessageBody;
    expect(body.scope).toBe("issue");
    expect(body.scopeRefId).toBe("issue-1");
    expect(body.userMessage).toBe("Что по задаче?");

    expect(screen.getByText("Источники:")).toBeInTheDocument();
    expect(screen.getByText("Планёрка")).toBeInTheDocument();
  });
});
