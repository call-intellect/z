import type {
  ConversationKindApi,
  InboxItemApi,
  InboxLinkedIssueApi,
  MessageApi,
  MessageAccessApi,
} from "@/api/threads.api";

export type ConversationKind = ConversationKindApi;
export type MessageAccess = MessageAccessApi;

export interface InboxLinkedIssue {
  id: string;
  identifier: string;
  title: string;
}

export interface InboxThread {
  kind: ConversationKind;
  refId: string;
  title: string;
  snippet: string;
  lastMessageAt: Date | null;
  unreadCount: number;
  hasUnread: boolean;
  status: string | null;
  slaBreached: boolean;
  linkedIssue: InboxLinkedIssue | null;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  seq: string;
  authorUserId: string;
  authorType: string;
  access: MessageAccess;
  content: string;
  parentMessageId: string | null;
  voiceUrl: string | null;
  voiceDuration: number | null;
  mentions: string[];
  reactions: Record<string, string[]>;
  createdAt: Date;
  editedAt: Date | null;
  isEdited: boolean;
  isSystem: boolean;
}

const parseDate = (s: string | null | undefined): Date | null =>
  s ? new Date(s) : null;

const parseAccess = (raw: string): MessageAccess => {
  if (raw === "internal") return "internal";
  if (raw === "external") return "external";
  return "normal";
};

function mapLinkedIssue(
  api: InboxLinkedIssueApi | null,
): InboxLinkedIssue | null {
  if (!api) return null;
  return { id: api.id, identifier: api.identifier, title: api.title };
}

export function inboxThreadFromApi(api: InboxItemApi): InboxThread {
  return {
    kind: api.kind,
    refId: api.refId,
    title: api.title,
    snippet: api.snippet,
    lastMessageAt: parseDate(api.lastMessageAt),
    unreadCount: api.unreadCount,
    hasUnread: api.unreadCount > 0,
    status: api.status,
    slaBreached: api.slaBreachedAt !== null,
    linkedIssue: mapLinkedIssue(api.linkedIssue),
  };
}

export function chatMessageFromApi(api: MessageApi): ChatMessage {
  const editedAt = parseDate(api.createdAt ? api.editedAt : null);
  return {
    id: api.id,
    conversationId: api.conversationId,
    seq: api.seq,
    authorUserId: api.authorUserId,
    authorType: api.authorType,
    access: parseAccess(api.access),
    content: api.content,
    parentMessageId: api.parentMessageId,
    voiceUrl: api.voiceUrl,
    voiceDuration: api.voiceDuration,
    mentions: api.mentions ?? [],
    reactions: api.reactions ?? {},
    createdAt: new Date(api.createdAt),
    editedAt,
    isEdited: editedAt !== null,
    isSystem: api.authorType === "system",
  };
}

export function kindLabel(kind: ConversationKind): string {
  switch (kind) {
    case "dm":
      return "Личное";
    case "group":
      return "Группа";
    case "channel":
      return "Канал";
    case "work_chat":
      return "Задача";
    case "external":
      return "Клиент";
    case "ticket":
      return "Обращение";
    default:
      return "";
  }
}
