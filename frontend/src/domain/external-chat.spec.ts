import { describe, expect, it } from "vitest";

import type { ExternalMessageApi } from "@/api/external-chat.api";

import {
  lastExternalSeq,
  mergeExternalMessages,
  toExternalMessage,
} from "./external-chat";

function api(overrides: Partial<ExternalMessageApi> = {}): ExternalMessageApi {
  return {
    id: "m1",
    conversationId: "c1",
    seq: "1",
    authorUserId: "u1",
    authorType: "human",
    access: "external",
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

describe("toExternalMessage", () => {
  it("маппит ApiDto в DomainModel с датами", () => {
    const m = toExternalMessage(api({ editedAt: "2026-06-28T11:00:00.000Z" }));
    expect(m.id).toBe("m1");
    expect(m.seq).toBe("1");
    expect(m.createdAt).toBeInstanceOf(Date);
    expect(m.editedAt).toBeInstanceOf(Date);
  });

  it("editedAt=null остаётся null", () => {
    expect(toExternalMessage(api()).editedAt).toBeNull();
  });
});

describe("mergeExternalMessages", () => {
  it("дедуплицирует по id и сортирует по seq (как bigint)", () => {
    const a = toExternalMessage(api({ id: "a", seq: "2" }));
    const b = toExternalMessage(api({ id: "b", seq: "10" }));
    const c = toExternalMessage(api({ id: "c", seq: "9" }));
    const merged = mergeExternalMessages([a], [c, b, a]);
    expect(merged.map((m) => m.id)).toEqual(["a", "c", "b"]);
  });

  it("пустой incoming возвращает существующий список без изменений", () => {
    const a = toExternalMessage(api({ id: "a", seq: "1" }));
    const existing = [a];
    expect(mergeExternalMessages(existing, [])).toBe(existing);
  });
});

describe("lastExternalSeq", () => {
  it("возвращает seq последнего сообщения", () => {
    const a = toExternalMessage(api({ id: "a", seq: "1" }));
    const b = toExternalMessage(api({ id: "b", seq: "5" }));
    expect(lastExternalSeq([a, b])).toBe("5");
  });

  it("пустой список → null", () => {
    expect(lastExternalSeq([])).toBeNull();
  });
});
