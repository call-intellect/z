import { describe, expect, it } from "vitest";

import type { ConciergeStreamEvent } from "@/api/concierge.api";
import type { InferredTableSchema } from "@/domain/table";
import { masterRowsFromEvent, type MasterRow } from "./master-chat-events";

function makeIdSeq(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `id-${n}`;
  };
}

const isInferredTableSchema = (d: unknown): d is InferredTableSchema =>
  !!d &&
  typeof d === "object" &&
  typeof (d as { name?: unknown }).name === "string" &&
  Array.isArray((d as { properties?: unknown }).properties);

const toolNameLabel = (t: string): string => `LBL(${t})`;

function apply(rows: MasterRow[], ev: ConciergeStreamEvent) {
  return masterRowsFromEvent(
    rows,
    ev,
    makeIdSeq(),
    isInferredTableSchema,
    toolNameLabel,
  );
}

describe("masterRowsFromEvent", () => {
  it("message с citations добавляет assistant-строку с text и citations", () => {
    const citations = [
      {
        meetingId: "m1",
        meetingTitle: "Планёрка",
        startMs: 1000,
        endMs: 2000,
        snippet: "цитата",
      },
    ];
    const res = apply([], {
      type: "message",
      text: "Ответ Мастера",
      citations,
    });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      role: "assistant",
      text: "Ответ Мастера",
      citations,
    });
  });

  it("tool_result с undoLogId даёт tool-строку и undo в результате", () => {
    const res = apply([], {
      type: "tool_result",
      toolName: "create_task",
      ok: true,
      status: 200,
      undoLogId: "undo-7",
      preview: "ok",
    });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      role: "tool",
      meta: { toolName: "create_task", ok: true, undoLogId: "undo-7" },
    });
    expect(res.rows[0]!.text).toContain("LBL(create_task)");
    expect(res.undo).toEqual({ toolName: "create_task", undoLogId: "undo-7" });
  });

  it("tool_result infer_table_schema даёт строку table_schema_preview со схемой", () => {
    const schema: InferredTableSchema = {
      name: "Контакты",
      description: null,
      icon: null,
      entitySync: null,
      properties: [{ name: "Имя", type: "text", isPrimary: true }],
    };
    const res = apply([], {
      type: "tool_result",
      toolName: "infer_table_schema",
      ok: true,
      status: 200,
      preview: "schema",
      data: schema,
    });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      kind: "table_schema_preview",
      role: "tool",
      schema,
    });
    expect(res.undo).toBeUndefined();
  });

  it("tool_call даёт system-строку", () => {
    const res = apply([], {
      type: "tool_call",
      toolName: "list_meetings",
      params: {},
      requiresConfirm: false,
    });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({ role: "system" });
    expect(res.rows[0]!.text).toBe("LBL(list_meetings)");
  });

  it("confirm_required даёт system-строку с «требуется подтверждение»", () => {
    const res = apply([], {
      type: "confirm_required",
      toolName: "cancel_meeting",
      params: {},
      preview: "preview",
    });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({ role: "system" });
    expect(res.rows[0]!.text).toBe("LBL(cancel_meeting): требуется подтверждение");
  });

  it("started возвращает startedConversationId без новых строк", () => {
    const res = apply([{ id: "x", role: "user", text: "hi" }], {
      type: "started",
      conversationId: "conv-42",
    });
    expect(res.startedConversationId).toBe("conv-42");
    expect(res.rows).toHaveLength(1);
  });

  it("quota_exceeded возвращает quota", () => {
    const res = apply([], { type: "quota_exceeded", scope: "monthly" });
    expect(res.quota).toBe("monthly");
    expect(res.rows).toHaveLength(0);
  });

  it("error возвращает error", () => {
    const res = apply([], {
      type: "error",
      code: "boom",
      message: "Что-то сломалось",
    });
    expect(res.error).toBe("Что-то сломалось");
    expect(res.rows).toHaveLength(0);
  });
});
