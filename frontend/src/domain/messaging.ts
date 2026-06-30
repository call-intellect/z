export type ConversationKind =
  | "dm"
  | "group"
  | "channel"
  | "work_chat"
  | "external"
  | "ticket";

export type MessageAccess = "normal" | "internal" | "external";

export interface InboxLinkedIssueApi {
  id: string;
  identifier: string;
  title: string;
}

export interface InboxItemApi {
  kind: ConversationKind;
  refId: string;
  title: string;
  snippet: string;
  lastMessageAt: string | null;
  unreadCount: number;
  status: string | null;
  slaBreachedAt: string | null;
  linkedIssue: InboxLinkedIssueApi | null;
}

export interface ListThreadsResponseApi {
  items: InboxItemApi[];
  nextCursor: string | null;
}

export interface MessageApi {
  id: string;
  conversationId: string;
  seq: string;
  authorUserId: string;
  authorType: string;
  access: string;
  content: string;
  parentMessageId: string | null;
  voiceUrl: string | null;
  voiceDuration: number | null;
  mentions: string[];
  reactions: Record<string, string[]> | null;
  createdAt: string;
  editedAt: string | null;
}

export interface ListMessagesResponseApi {
  items: MessageApi[];
  nextSeq: string | null;
}

export interface SendMessageResponseApi {
  message: MessageApi;
  deduped: boolean;
}

export interface ReactionsResponseApi {
  messageId: string;
  reactions: Record<string, string[]>;
}

export interface SearchMessageItemApi {
  conversationId: string;
  messageId: string;
  snippet: string;
}

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
}

const parseDate = (s: string | null | undefined): Date | null =>
  s ? new Date(s) : null;

const parseAccess = (raw: string): MessageAccess => {
  if (raw === "internal") return "internal";
  if (raw === "external") return "external";
  return "normal";
};

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
    linkedIssue: api.linkedIssue,
  };
}

export function chatMessageFromApi(api: MessageApi): ChatMessage {
  const editedAt = parseDate(api.editedAt);
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
  };
}

export function seqGreater(a: string, b: string): boolean {
  if (a.length !== b.length) return a.length > b.length;
  return a > b;
}

export function maxSeq(messages: { seq: string }[]): string | null {
  let max: string | null = null;
  for (const m of messages) {
    if (max === null || seqGreater(m.seq, max)) max = m.seq;
  }
  return max;
}
