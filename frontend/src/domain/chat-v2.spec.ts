import { describe, expect, it } from "vitest";

import type { AskCloneResponseApi } from "@/api/clones.api";

import {
  cloneAnswerToChatV2Message,
  cloneCitationToChatV2Citation,
  stripContextMarkers,
} from "./chat-v2";

describe("stripContextMarkers (#57)", () => {
  it("снимает все формы служебных маркеров", () => {
    expect(stripContextMarkers("Ответ [BLOCK:abc123] готов.")).toBe(
      "Ответ готов.",
    );
    expect(stripContextMarkers("Текст [DECISION:dec_1] далее")).toBe(
      "Текст далее",
    );
    expect(stripContextMarkers("A [CONTRADICTING BLOCK] B")).toBe("A B");
    expect(stripContextMarkers("A [CONTRADICTING BLOCK:xy-9] B")).toBe("A B");
    expect(
      stripContextMarkers("Вот [REASONING CHAIN FOR BLOCK blk7] цепочка"),
    ).toBe("Вот цепочка");
  });

  it("снимает несколько маркеров в одной строке", () => {
    expect(stripContextMarkers("X [BLOCK:a] Y [DECISION:b] Z")).toBe("X Y Z");
  });

  it("НЕ трогает markdown-ссылку [текст](url)", () => {
    const md = "См. [документацию](https://example.com/doc) здесь.";
    expect(stripContextMarkers(md)).toBe(md);
  });

  it("НЕ трогает обычный текст в скобках", () => {
    const t = "Это (обычный текст) и [просто строка] остаётся.";
    expect(stripContextMarkers(t)).toBe(t);
  });

  it("сохраняет переводы строк (для whitespace-pre-wrap)", () => {
    expect(stripContextMarkers("Строка 1 [BLOCK:a]\nСтрока 2")).toBe(
      "Строка 1\nСтрока 2",
    );
  });

  it("идемпотентность — повторный вызов ничего не меняет", () => {
    const once = stripContextMarkers("Ответ [BLOCK:abc] готов [DECISION:d].");
    expect(stripContextMarkers(once)).toBe(once);
  });

  it("без маркеров — возвращает исходный текст (только trim)", () => {
    expect(stripContextMarkers("Просто ответ.")).toBe("Просто ответ.");
  });
});

describe("cloneAnswerToChatV2Message (ТЗ#5)", () => {
  const base: AskCloneResponseApi = {
    conversationId: "conv-1",
    messageId: "msg-1",
    text: "Как маркетолог, я бы сделал X.",
    citations: [],
    mode: "clone_style",
    isOwner: false,
  };

  it("маппит текст, id и mode=clone_style", () => {
    const msg = cloneAnswerToChatV2Message(base);
    expect(msg.id).toBe("msg-1");
    expect(msg.conversationId).toBe("conv-1");
    expect(msg.role).toBe("assistant");
    expect(msg.mode).toBe("clone_style");
    expect(msg.text).toBe("Как маркетолог, я бы сделал X.");
    expect(msg.createdAt).toBeInstanceOf(Date);
  });

  it("маппит citations со встречей; цитаты без meetingId/Title опускает", () => {
    const msg = cloneAnswerToChatV2Message({
      ...base,
      citations: [
        {
          blockId: "b1",
          meetingId: "m1",
          meetingTitle: "Планёрка",
          startMs: 1000,
          endMs: 2000,
          snippet: "фрагмент",
        },
        { blockId: "b2" },
      ],
    });
    expect(msg.citations).toHaveLength(1);
    expect(msg.citations[0]).toMatchObject({
      meetingId: "m1",
      meetingTitle: "Планёрка",
      startMs: 1000,
      endMs: 2000,
      snippet: "фрагмент",
    });
  });

  it("refused:true — это сообщение (text рендерится), не ошибка; флаг в llmMeta", () => {
    const msg = cloneAnswerToChatV2Message({
      ...base,
      text: "В архиве недостаточно обсуждений по этой теме.",
      refused: true,
      refusalReason: "topic_starved",
    });
    expect(msg.text).toBe("В архиве недостаточно обсуждений по этой теме.");
    expect(msg.llmMeta).toMatchObject({
      refused: true,
      refusalReason: "topic_starved",
    });
  });

  it("отсутствие refused трактуется как false", () => {
    const msg = cloneAnswerToChatV2Message(base);
    expect(msg.llmMeta).toMatchObject({ refused: false, refusalReason: null });
  });

  it("citations=undefined — пустой массив без падения", () => {
    const msg = cloneAnswerToChatV2Message({
      ...base,
      citations: undefined as unknown as AskCloneResponseApi["citations"],
    });
    expect(msg.citations).toEqual([]);
  });
});

describe("cloneCitationToChatV2Citation (ТЗ#5)", () => {
  it("возвращает null, если в цитате нет meetingId и meetingTitle", () => {
    expect(cloneCitationToChatV2Citation({ blockId: "b" })).toBeNull();
  });

  it("подставляет дефолты для отсутствующих числовых полей", () => {
    const c = cloneCitationToChatV2Citation({
      blockId: "b",
      meetingTitle: "Встреча",
    });
    expect(c).toEqual({
      meetingId: "",
      meetingTitle: "Встреча",
      startMs: 0,
      endMs: 0,
      snippet: "",
    });
  });
});
