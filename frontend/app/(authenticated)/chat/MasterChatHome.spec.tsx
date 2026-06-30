import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { ConciergeConversationListItem } from "@/domain/concierge-conversation";
import type { ConciergeConversationDetail } from "@/domain/concierge-conversation";

const conversationsMock = vi.fn();
const conversationMock = vi.fn();

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ currentOrgId: "org-1" }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("@/hooks/useConciergeConversations", () => ({
  useConciergeConversations: () => conversationsMock(),
}));

vi.mock("@/hooks/useConciergeConversation", () => ({
  useConciergeConversation: (id: string | null) => conversationMock(id),
}));

vi.mock("@/hooks/useClones", () => ({
  useClones: () => ({ items: [], total: 0, isLoading: false }),
  useMyCloneAccess: () => ({ access: null }),
}));

vi.mock("@/api/concierge.api", () => ({
  conciergeApi: { undo: vi.fn(), askOnce: vi.fn() },
  conciergeStreamApi: vi.fn(),
}));

import { MasterChatHome } from "./MasterChatHome";

function makeConversation(
  id: string,
  title: string,
): ConciergeConversationListItem {
  return {
    id,
    title,
    startedAt: new Date("2026-06-01T10:00:00Z"),
    lastMessageAt: new Date("2026-06-02T12:00:00Z"),
    archivedAt: null,
  };
}

function emptyDetail(): ConciergeConversationDetail {
  return { id: "", summary: null, messages: [] };
}

describe("MasterChatHome", () => {
  beforeEach(() => {
    conversationsMock.mockReset();
    conversationMock.mockReset();
    conversationMock.mockReturnValue({
      data: emptyDetail(),
      isLoading: false,
      error: null,
      mutate: vi.fn(),
    });
  });

  it("рендерит список из двух диалогов и кнопку «Новый диалог»", () => {
    conversationsMock.mockReturnValue({
      data: [
        makeConversation("c1", "Первый диалог"),
        makeConversation("c2", "Второй диалог"),
      ],
      isLoading: false,
      error: null,
      mutate: vi.fn(),
    });

    render(<MasterChatHome />);

    expect(screen.getByText("Первый диалог")).toBeInTheDocument();
    expect(screen.getByText("Второй диалог")).toBeInTheDocument();
    expect(screen.getByText("Новый диалог")).toBeInTheDocument();
  });

  it("при выбранном диалоге рендерит прошлые сообщения из истории", () => {
    conversationsMock.mockReturnValue({
      data: [makeConversation("c1", "Первый диалог")],
      isLoading: false,
      error: null,
      mutate: vi.fn(),
    });
    conversationMock.mockReturnValue({
      data: {
        id: "c1",
        summary: null,
        messages: [
          {
            id: "m1",
            role: "user",
            content: "Какие были встречи?",
            createdAt: new Date(),
          },
          {
            id: "m2",
            role: "assistant",
            content: "Вот список встреч за неделю.",
            createdAt: new Date(),
          },
        ],
      },
      isLoading: false,
      error: null,
      mutate: vi.fn(),
    });

    render(<MasterChatHome />);

    fireEvent.click(screen.getByText("Первый диалог"));

    expect(screen.getByText("Какие были встречи?")).toBeInTheDocument();
    expect(
      screen.getByText("Вот список встреч за неделю."),
    ).toBeInTheDocument();
  });
});
