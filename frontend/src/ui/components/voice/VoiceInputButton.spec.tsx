import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { VoiceInputButton, appendTranscript } from "./VoiceInputButton";

const transcribeMock = vi.fn();
vi.mock("@/api/voice.api", () => ({
  voiceApi: {
    transcribe: (...args: unknown[]) => transcribeMock(...args),
  },
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ currentOrgId: "org1" }),
}));

vi.mock("@/ui/concierge/audio-mime", () => ({
  pickSupportedMimeType: () => "audio/webm",
}));

type RecorderInstance = {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  ondataavailable: ((ev: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  state: "inactive" | "recording";
  mimeType: string;
};

let lastRecorder: RecorderInstance | null = null;

class MockMediaRecorder {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  ondataavailable: ((ev: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  state: "inactive" | "recording" = "inactive";
  mimeType: string;

  constructor(_stream: MediaStream, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? "audio/webm";
    this.start = vi.fn(() => {
      this.state = "recording";
      this.ondataavailable?.({
        data: new Blob(["x"], { type: this.mimeType }),
      });
    });
    this.stop = vi.fn(() => {
      this.state = "inactive";
      this.onstop?.();
    });
    lastRecorder = this as unknown as RecorderInstance;
  }

  static isTypeSupported(): boolean {
    return true;
  }
}

function makeFakeStream(): MediaStream {
  const track = { stop: vi.fn() };
  return {
    getTracks: () => [track],
  } as unknown as MediaStream;
}

const getUserMediaMock = vi.fn();

function installMediaRecording(): void {
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder =
    MockMediaRecorder;
  getUserMediaMock.mockResolvedValue(makeFakeStream());
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: getUserMediaMock },
  });
}

function removeMediaRecording(): void {
  delete (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: undefined,
  });
}

beforeEach(() => {
  transcribeMock.mockReset();
  getUserMediaMock.mockReset();
  lastRecorder = null;
});

afterEach(() => {
  removeMediaRecording();
  vi.restoreAllMocks();
});

describe("appendTranscript", () => {
  it("пустое поле → только новый текст без ведущего пробела", () => {
    expect(appendTranscript("", "привет")).toBe("привет");
  });

  it("тримит распознанный фрагмент", () => {
    expect(appendTranscript("", "  привет  ")).toBe("привет");
  });

  it("непустое поле → добавляет через пробел", () => {
    expect(appendTranscript("первый пункт", "второй")).toBe(
      "первый пункт второй",
    );
  });

  it("не дублирует разделитель, если предыдущее кончается пробелом", () => {
    expect(appendTranscript("первый ", "второй")).toBe("первый второй");
  });

  it("не дублирует разделитель, если предыдущее кончается переводом строки", () => {
    expect(appendTranscript("первый\n", "второй")).toBe("первый\nвторой");
  });

  it("пустой фрагмент не меняет значение", () => {
    expect(appendTranscript("текст", "   ")).toBe("текст");
  });
});

describe("VoiceInputButton", () => {
  it("нет getUserMedia (iOS без полифилла / SSR) → graceful: кнопки нет", () => {
    removeMediaRecording();
    const { container } = render(<VoiceInputButton onTranscript={vi.fn()} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByLabelText("Голосовой ввод")).not.toBeInTheDocument();
  });

  it("тап старт → getUserMedia + recorder.start вызваны, состояние recording", async () => {
    installMediaRecording();
    render(<VoiceInputButton onTranscript={vi.fn()} />);

    const button = await screen.findByLabelText("Голосовой ввод");
    expect(button).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(button);

    await waitFor(() => {
      expect(getUserMediaMock).toHaveBeenCalledWith(
        expect.objectContaining({ audio: true }),
      );
    });
    expect(lastRecorder?.start).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(button).toHaveAttribute("aria-pressed", "true");
    });
  });

  it('тап стоп → transcribe вызван, onTranscript("привет") получен', async () => {
    installMediaRecording();
    transcribeMock.mockResolvedValue({ text: "привет" });
    const onTranscript = vi.fn();
    render(<VoiceInputButton onTranscript={onTranscript} />);

    const button = await screen.findByLabelText("Голосовой ввод");
    fireEvent.click(button);
    await waitFor(() => {
      expect(button).toHaveAttribute("aria-pressed", "true");
    });

    fireEvent.click(button);

    await waitFor(() => {
      expect(transcribeMock).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: "org1" }),
      );
    });
    await waitFor(() => {
      expect(onTranscript).toHaveBeenCalledWith("привет");
    });
    await waitFor(() => {
      expect(button).toHaveAttribute("aria-pressed", "false");
    });
  });

  it("пустой текст transcribe → onTranscript НЕ вызван, показан error", async () => {
    installMediaRecording();
    transcribeMock.mockResolvedValue({ text: "   " });
    const onTranscript = vi.fn();
    render(<VoiceInputButton onTranscript={onTranscript} />);

    const button = await screen.findByLabelText("Голосовой ввод");
    fireEvent.click(button);
    await waitFor(() => {
      expect(button).toHaveAttribute("aria-pressed", "true");
    });
    fireEvent.click(button);

    await waitFor(() => {
      expect(transcribeMock).toHaveBeenCalledTimes(1);
    });
    expect(onTranscript).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(button).toHaveAttribute(
        "title",
        expect.stringContaining("распознать"),
      );
    });
  });

  it("ошибка transcribe → onTranscript НЕ вызван, показан error", async () => {
    installMediaRecording();
    transcribeMock.mockRejectedValue(new Error("boom"));
    const onTranscript = vi.fn();
    render(<VoiceInputButton onTranscript={onTranscript} />);

    const button = await screen.findByLabelText("Голосовой ввод");
    fireEvent.click(button);
    await waitFor(() => {
      expect(button).toHaveAttribute("aria-pressed", "true");
    });
    fireEvent.click(button);

    await waitFor(() => {
      expect(transcribeMock).toHaveBeenCalledTimes(1);
    });
    expect(onTranscript).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(button).toHaveAttribute("aria-pressed", "false");
    });
  });
});
