import type {
  ConciergeConversationApi,
  ConciergeConversationDetailApi,
  ConciergeMessageApi,
} from "@/api/concierge.api";

export interface ConciergeConversationListItem {
  id: string;
  title: string;
  startedAt: Date;
  lastMessageAt: Date | null;
  archivedAt: Date | null;
}

export interface ConciergeChatMessage {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
}

export interface ConciergeConversationDetail {
  id: string;
  summary: string | null;
  messages: ConciergeChatMessage[];
}

const DEFAULT_TITLE = "Новый диалог";

export function conciergeConversationTitle(
  summary: string | null,
  titlePreview: string | null,
): string {
  const s = summary?.trim();
  if (s) return s;
  const t = titlePreview?.trim();
  if (t) return t;
  return DEFAULT_TITLE;
}

export function toConciergeConversationListItem(
  dto: ConciergeConversationApi,
): ConciergeConversationListItem {
  return {
    id: dto.id,
    title: conciergeConversationTitle(dto.summary, dto.titlePreview),
    startedAt: new Date(dto.startedAt),
    lastMessageAt: dto.lastMessageAt ? new Date(dto.lastMessageAt) : null,
    archivedAt: dto.archivedAt ? new Date(dto.archivedAt) : null,
  };
}

export function toConciergeChatMessage(
  dto: ConciergeMessageApi,
): ConciergeChatMessage {
  return {
    id: dto.id,
    role: dto.role,
    content: dto.content,
    createdAt: new Date(dto.createdAt),
  };
}

export function toConciergeConversationDetail(
  dto: ConciergeConversationDetailApi,
): ConciergeConversationDetail {
  return {
    id: dto.id,
    summary: dto.summary,
    messages: dto.messages.map(toConciergeChatMessage),
  };
}
