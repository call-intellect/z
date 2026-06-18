import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { AssistantTarget } from "@/domain/chat-v2";

const streamMock = vi.fn();
const askMock = vi.fn();
const askRoleMock = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock("swr", () => ({
  __esModule: true,
  default: () => ({
    data: undefined,
    isLoading: false,
    error: undefined,
    mutate: vi.fn(),
  }),
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ currentOrgId: "org-1", isLoading: false }),
}));

vi.mock("@/ui/components/shared/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ ask: vi.fn(), dialog: null }),
}));

vi.mock("@/ui/components/chat-v2/AssistantMarkdown", () => ({
  AssistantMarkdown: ({ text }: { text: string }) => <div>{text}</div>,
}));

vi.mock("@/ui/components/chat-v2/AssistantTargetSelect", () => ({
  AssistantTargetSelect: ({
    value,
    onChange,
  }: {
    value: AssistantTarget;
    onChange: (t: AssistantTarget) => void;
  }) => (
    <select
      aria-label="target-select"
      value={value.kind === "assistant" ? "assistant" : value.roleId}
      onChange={(e) => {
        if (e.target.value === "assistant") {
          onChange({ kind: "assistant" });
        } else {
          onChange({
            kind: "clone",
            roleId: e.target.value,
            roleName: "Клон Маркетолога",
          });
        }
      }}
    >
      <option value="assistant">помощник</option>
      <option value="role-mkt">клон</option>
    </select>
  ),
}));

vi.mock("@/api/chat-v2.api", () => ({
  chatV2Api: { ask: (...a: unknown[]) => askMock(...a) },
  streamChatV2Message: (...a: unknown[]) => streamMock(...a),
}));

vi.mock("@/api/clones.api", () => ({
  clonesApi: {
    askRole: (...a: unknown[]) => askRoleMock(...a),
    requestAccess: vi.fn(),
  },
}));

import { ChatV2Client } from "@app/(authenticated)/chat-v2/ChatV2Client";

async function* doneStream() {
  yield {
    type: "done" as const,
    conversationId: "conv-assistant",
    messageId: "m-assistant",
    text: "Ответ помощника",
    citations: [],
    uncertaintyNote: null,
    mode: "synthetic" as const,
    cacheHit: false,
  };
}

function typeAndSend(question: string) {
  const inputs = screen.getAllByPlaceholderText(/Спросите/i);
  const input = inputs[inputs.length - 1]!;
  fireEvent.change(input, { target: { value: question } });
  const form = input.closest("form")!;
  fireEvent.submit(form);
}

describe("ChatV2Client onSubmit branching (ТЗ#5)", () => {
  beforeEach(() => {
    streamMock.mockReset();
    askMock.mockReset();
    askRoleMock.mockReset();
  });

  it("адресат «помощник» (дефолт) → вызван stream, askRole НЕ вызван", async () => {
    streamMock.mockImplementation(() => doneStream());
    render(<ChatV2Client />);

    typeAndSend("Сколько у нас сделок?");

    await waitFor(() => expect(streamMock).toHaveBeenCalledTimes(1));
    expect(askRoleMock).not.toHaveBeenCalled();
    expect(streamMock.mock.calls[0]![0]).toMatchObject({
      question: "Сколько у нас сделок?",
    });
  });

  it("адресат «клон» → askRole вызван с roleId; ответ клона в нити", async () => {
    askRoleMock.mockResolvedValue({
      conversationId: "clone-conv-1",
      messageId: "clone-msg-1",
      text: "Как маркетолог, рекомендую X.",
      citations: [],
      mode: "clone_style",
      isOwner: false,
      refused: false,
    });
    render(<ChatV2Client />);

    fireEvent.change(screen.getByLabelText("target-select"), {
      target: { value: "role-mkt" },
    });

    typeAndSend("Как продвигать продукт?");

    await waitFor(() => expect(askRoleMock).toHaveBeenCalledTimes(1));
    expect(streamMock).not.toHaveBeenCalled();
    expect(askRoleMock.mock.calls[0]![0]).toBe("org-1");
    expect(askRoleMock.mock.calls[0]![1]).toBe("role-mkt");
    expect(askRoleMock.mock.calls[0]![2]).toMatchObject({
      question: "Как продвигать продукт?",
    });

    expect(
      await screen.findByText("Как маркетолог, рекомендую X."),
    ).toBeInTheDocument();
  });
});
