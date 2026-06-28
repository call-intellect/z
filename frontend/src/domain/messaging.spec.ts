import { describe, expect, it } from "vitest";

import {
  chatMessageFromApi,
  inboxThreadFromApi,
  maxSeq,
  seqGreater,
  type InboxItemApi,
  type MessageApi,
} from "./messaging";

function inbox(overrides: Partial<InboxItemApi> = {}): InboxItemApi {
  return {
    kind: "dm",
    refId: "c1",
    title: "Алиса",
    snippet: "Привет",
    lastMessageAt: "2026-06-28T10:00:00.000Z",
    unreadCount: 0,
    status: null,
    slaBreachedAt: null,
    linkedIssue: null,
    ...overrides,
  };
}

function msg(overrides: Partial<MessageApi> = {}): MessageApi {
  return {
    id: "m1",
    conversationId: "c1",
    seq: "1",
    authorUserId: "u1",
    authorType: "human",
    access: "normal",
    content: "Привет",
    parentMessageId: null,
    voiceUrl: null,
    voiceDuration: null,
    mentions: [],
    reactions: null,
    createdAt: "2026-06-28T10:00:00.000Z",
    editedAt: null,
    ...overrides,
  };
}

describe("inboxThreadFromApi", () => {
  it("maps base fields and derives hasUnread", () => {
    const t = inboxThreadFromApi(inbox({ unreadCount: 3 }));
    expect(t.kind).toBe("dm");
    expect(t.refId).toBe("c1");
    expect(t.unreadCount).toBe(3);
    expect(t.hasUnread).toBe(true);
    expect(t.lastMessageAt).toBeInstanceOf(Date);
  });

  it("null lastMessageAt → null date, hasUnread false at 0", () => {
    const t = inboxThreadFromApi(inbox({ lastMessageAt: null, unreadCount: 0 }));
    expect(t.lastMessageAt).toBeNull();
    expect(t.hasUnread).toBe(false);
  });

  it("derives slaBreached from slaBreachedAt", () => {
    expect(inboxThreadFromApi(inbox()).slaBreached).toBe(false);
    expect(
      inboxThreadFromApi(inbox({ slaBreachedAt: "2026-06-28T11:00:00.000Z" }))
        .slaBreached,
    ).toBe(true);
  });

  it("carries linkedIssue for work_chat", () => {
    const t = inboxThreadFromApi(
      inbox({
        kind: "work_chat",
        linkedIssue: { id: "i1", identifier: "PROJ-7", title: "Фикс" },
      }),
    );
    expect(t.linkedIssue?.identifier).toBe("PROJ-7");
  });
});

describe("chatMessageFromApi", () => {
  it("normalizes access and defaults reactions/mentions", () => {
    const m = chatMessageFromApi(msg({ access: "internal", reactions: null }));
    expect(m.access).toBe("internal");
    expect(m.reactions).toEqual({});
    expect(m.mentions).toEqual([]);
    expect(m.isEdited).toBe(false);
  });

  it("unknown access falls back to normal", () => {
    expect(chatMessageFromApi(msg({ access: "weird" })).access).toBe("normal");
  });

  it("editedAt → isEdited true", () => {
    const m = chatMessageFromApi(
      msg({ editedAt: "2026-06-28T12:00:00.000Z" }),
    );
    expect(m.isEdited).toBe(true);
    expect(m.editedAt).toBeInstanceOf(Date);
  });

  it("keeps seq as string", () => {
    expect(chatMessageFromApi(msg({ seq: "42" })).seq).toBe("42");
  });
});

describe("seq ordering helpers", () => {
  it("seqGreater compares numerically by length then lexicographically", () => {
    expect(seqGreater("10", "9")).toBe(true);
    expect(seqGreater("9", "10")).toBe(false);
    expect(seqGreater("12", "11")).toBe(true);
    expect(seqGreater("5", "5")).toBe(false);
  });

  it("maxSeq returns the largest seq", () => {
    expect(maxSeq([{ seq: "1" }, { seq: "10" }, { seq: "2" }])).toBe("10");
    expect(maxSeq([])).toBeNull();
  });
});
