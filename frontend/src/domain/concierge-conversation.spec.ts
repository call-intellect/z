import { describe, expect, it } from "vitest";

import type {
  ConciergeConversationApi,
  ConciergeConversationDetailApi,
} from "@/api/concierge.api";

import {
  conciergeConversationTitle,
  toConciergeConversationDetail,
  toConciergeConversationListItem,
} from "./concierge-conversation";

describe("conciergeConversationTitle", () => {
  it("отдаёт приоритет summary над titlePreview", () => {
    expect(conciergeConversationTitle("Итог встречи", "Превью")).toBe(
      "Итог встречи",
    );
  });

  it("при пустом/пробельном summary берёт titlePreview", () => {
    expect(conciergeConversationTitle(null, "Превью")).toBe("Превью");
    expect(conciergeConversationTitle("", "Превью")).toBe("Превью");
    expect(conciergeConversationTitle("   ", "Превью")).toBe("Превью");
  });

  it("при пустых обоих возвращает дефолтный заголовок", () => {
    expect(conciergeConversationTitle(null, null)).toBe("Новый диалог");
    expect(conciergeConversationTitle("", "")).toBe("Новый диалог");
    expect(conciergeConversationTitle("  ", "  ")).toBe("Новый диалог");
  });
});

describe("toConciergeConversationListItem", () => {
  const base: ConciergeConversationApi = {
    id: "c1",
    startedAt: "2026-06-20T10:00:00.000Z",
    lastMessageAt: "2026-06-20T11:30:00.000Z",
    summary: "Обсуждение релиза",
    titlePreview: "Привет, как дела",
    archivedAt: null,
  };

  it("маппит ISO-строки в Date", () => {
    const item = toConciergeConversationListItem(base);
    expect(item.startedAt).toBeInstanceOf(Date);
    expect(item.startedAt.toISOString()).toBe("2026-06-20T10:00:00.000Z");
    expect(item.lastMessageAt).toBeInstanceOf(Date);
    expect(item.lastMessageAt?.toISOString()).toBe("2026-06-20T11:30:00.000Z");
  });

  it("преобразует null lastMessageAt / archivedAt в null", () => {
    const item = toConciergeConversationListItem({
      ...base,
      lastMessageAt: null,
      archivedAt: null,
    });
    expect(item.lastMessageAt).toBeNull();
    expect(item.archivedAt).toBeNull();
  });

  it("маппит archivedAt в Date когда задан", () => {
    const item = toConciergeConversationListItem({
      ...base,
      archivedAt: "2026-06-21T00:00:00.000Z",
    });
    expect(item.archivedAt).toBeInstanceOf(Date);
    expect(item.archivedAt?.toISOString()).toBe("2026-06-21T00:00:00.000Z");
  });

  it("вычисляет title по приоритету summary → titlePreview → дефолт", () => {
    expect(toConciergeConversationListItem(base).title).toBe(
      "Обсуждение релиза",
    );
    expect(
      toConciergeConversationListItem({ ...base, summary: null }).title,
    ).toBe("Привет, как дела");
    expect(
      toConciergeConversationListItem({
        ...base,
        summary: null,
        titlePreview: null,
      }).title,
    ).toBe("Новый диалог");
  });
});

describe("toConciergeConversationDetail", () => {
  const dto: ConciergeConversationDetailApi = {
    id: "c1",
    summary: "Итог",
    messages: [
      {
        id: "m1",
        role: "user",
        content: "Вопрос",
        createdAt: "2026-06-20T10:00:00.000Z",
      },
      {
        id: "m2",
        role: "assistant",
        content: "Ответ",
        createdAt: "2026-06-20T10:00:05.000Z",
      },
    ],
  };

  it("маппит summary и сообщения", () => {
    const detail = toConciergeConversationDetail(dto);
    expect(detail.id).toBe("c1");
    expect(detail.summary).toBe("Итог");
    expect(detail.messages).toHaveLength(2);
    expect(detail.messages[0].role).toBe("user");
    expect(detail.messages[0].content).toBe("Вопрос");
  });

  it("преобразует createdAt сообщений в Date", () => {
    const detail = toConciergeConversationDetail(dto);
    expect(detail.messages[0].createdAt).toBeInstanceOf(Date);
    expect(detail.messages[0].createdAt.toISOString()).toBe(
      "2026-06-20T10:00:00.000Z",
    );
    expect(detail.messages[1].createdAt.toISOString()).toBe(
      "2026-06-20T10:00:05.000Z",
    );
  });
});
