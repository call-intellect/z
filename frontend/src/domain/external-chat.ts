import type { ExternalMessageApi } from "@/api/external-chat.api";

export type ExternalMessageAuthorType = "human" | "clone" | "system" | string;

export interface ExternalMessage {
  id: string;
  conversationId: string;
  seq: string;
  authorUserId: string;
  authorType: ExternalMessageAuthorType;
  access: string;
  content: string;
  createdAt: Date;
  editedAt: Date | null;
}

export function toExternalMessage(dto: ExternalMessageApi): ExternalMessage {
  return {
    id: dto.id,
    conversationId: dto.conversationId,
    seq: dto.seq,
    authorUserId: dto.authorUserId,
    authorType: dto.authorType,
    access: dto.access,
    content: dto.content,
    createdAt: new Date(dto.createdAt),
    editedAt: dto.editedAt ? new Date(dto.editedAt) : null,
  };
}

export function mergeExternalMessages(
  existing: ExternalMessage[],
  incoming: ExternalMessage[],
): ExternalMessage[] {
  if (incoming.length === 0) return existing;
  const byId = new Map<string, ExternalMessage>();
  for (const m of existing) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return Array.from(byId.values()).sort((a, b) => {
    const sa = BigInt(a.seq);
    const sb = BigInt(b.seq);
    if (sa < sb) return -1;
    if (sa > sb) return 1;
    return 0;
  });
}

export function lastExternalSeq(messages: ExternalMessage[]): string | null {
  if (messages.length === 0) return null;
  return messages[messages.length - 1]!.seq;
}

const TIME_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
});

export function formatExternalMessageTime(date: Date): string {
  return TIME_FORMAT.format(date);
}
