import type { ConciergeStreamEvent } from "@/api/concierge.api";
import type { ChatV2CitationApi } from "@/api/chat-v2.api";
import type { InferredTableSchema } from "@/domain/table";

export interface MasterRow {
  id: string;
  kind?: "table_schema_preview";
  role: "user" | "assistant" | "tool" | "system";
  text: string;
  citations?: ChatV2CitationApi[];
  meta?: { toolName?: string; ok?: boolean; undoLogId?: string };
  schema?: InferredTableSchema;
}

export interface MasterEventResult {
  rows: MasterRow[];
  undo?: { toolName: string; undoLogId: string };
  startedConversationId?: string;
  quota?: "daily" | "monthly";
  error?: string;
}

export function masterRowsFromEvent(
  rows: MasterRow[],
  ev: ConciergeStreamEvent,
  idSeq: () => string,
  isInferredTableSchema: (d: unknown) => d is InferredTableSchema,
  toolNameLabel: (t: string) => string,
): MasterEventResult {
  switch (ev.type) {
    case "started":
      return { rows, startedConversationId: ev.conversationId };

    case "tool_call":
      return {
        rows: [
          ...rows,
          {
            id: idSeq(),
            role: "system",
            text: `${toolNameLabel(ev.toolName)}${
              ev.requiresConfirm ? " (требуется подтверждение)" : ""
            }`,
          },
        ],
      };

    case "confirm_required":
      return {
        rows: [
          ...rows,
          {
            id: idSeq(),
            role: "system",
            text: `${toolNameLabel(ev.toolName)}: требуется подтверждение`,
          },
        ],
      };

    case "tool_result": {
      if (
        ev.toolName === "infer_table_schema" &&
        ev.ok &&
        isInferredTableSchema(ev.data)
      ) {
        return {
          rows: [
            ...rows,
            {
              id: idSeq(),
              kind: "table_schema_preview",
              role: "tool",
              text: "Предлагаю такую таблицу",
              schema: ev.data,
            },
          ],
        };
      }
      const next: MasterRow[] = [
        ...rows,
        {
          id: idSeq(),
          role: "tool",
          text: `${toolNameLabel(ev.toolName)}: ${
            ev.ok ? "успех" : `ошибка ${ev.status}`
          }`,
          meta: {
            toolName: ev.toolName,
            ok: ev.ok,
            ...(ev.undoLogId ? { undoLogId: ev.undoLogId } : {}),
          },
        },
      ];
      return {
        rows: next,
        ...(ev.undoLogId
          ? { undo: { toolName: ev.toolName, undoLogId: ev.undoLogId } }
          : {}),
      };
    }

    case "message":
      return {
        rows: [
          ...rows,
          {
            id: idSeq(),
            role: "assistant",
            text: ev.text,
            ...(ev.citations ? { citations: ev.citations } : {}),
          },
        ],
      };

    case "quota_exceeded":
      return { rows, quota: ev.scope };

    case "error":
      return { rows, error: ev.message };

    case "thinking":
    case "done":
    default:
      return { rows };
  }
}
