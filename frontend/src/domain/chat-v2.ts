import type {
  ChatV2CitationApi,
  ChatV2ConversationApi,
  ChatV2ConversationStatusApi,
  ChatV2ConversationWithMessagesApi,
  ChatV2MessageApi,
  ChatV2MessageRoleApi,
  ChatV2ModeApi,
  ChatV2ScopeApi,
} from "@/api/chat-v2.api";
import type { AskCloneResponseApi, CloneCitationApi } from "@/api/clones.api";

export type ChatV2Scope = ChatV2ScopeApi;
export type ChatV2Mode = ChatV2ModeApi;
export type ChatV2ConversationStatus = ChatV2ConversationStatusApi;
export type ChatV2MessageRole = ChatV2MessageRoleApi;

export interface ChatV2Citation {
  meetingId: string;
  meetingTitle: string;
  startMs: number;
  endMs: number;
  snippet: string;
  documentId?: string;
  documentName?: string;
}

export interface ChatV2Message {
  id: string;
  conversationId: string;
  role: ChatV2MessageRole;
  mode: ChatV2Mode | null;
  text: string;
  citations: ChatV2Citation[];
  retrievalMeta: Record<string, unknown> | null;
  llmMeta: Record<string, unknown> | null;
  createdAt: Date;
}

export interface ChatV2Conversation {
  id: string;
  tenantId: string;
  userId: string;
  title: string | null;
  scope: ChatV2Scope;
  scopeRefId: string | null;
  channelKindOrigin: string | null;
  status: ChatV2ConversationStatus;
  pinnedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatV2ConversationWithMessages extends ChatV2Conversation {
  messages: ChatV2Message[];
}

const SCOPE_LABEL: Record<ChatV2Scope, string> = {
  org: "Вся компания",
  meeting: "Встреча",
  card: "Карточка",
  theme: "Тема",
  entity: "Сущность",
  personal: "Личный",
  issue: "Задача",
};

const MODE_LABEL: Record<ChatV2Mode, string> = {
  factual: "Факты",
  synthetic: "Синтез",
  clone_style: "Клон сотрудника",
};

const STATUS_LABEL: Record<ChatV2ConversationStatus, string> = {
  active: "Активный",
  archived: "В архиве",
};

export function chatV2ScopeLabel(scope: ChatV2Scope): string {
  return SCOPE_LABEL[scope] ?? scope;
}

export function chatV2ConversationStatusLabel(
  status: ChatV2ConversationStatus,
): string {
  return STATUS_LABEL[status] ?? status;
}

export function toChatV2Citation(dto: ChatV2CitationApi): ChatV2Citation {
  return {
    meetingId: dto.meetingId,
    meetingTitle: dto.meetingTitle,
    startMs: dto.startMs,
    endMs: dto.endMs,
    snippet: dto.snippet,
    documentId: dto.documentId,
    documentName: dto.documentName,
  };
}

export function toChatV2Message(dto: ChatV2MessageApi): ChatV2Message {
  return {
    id: dto.id,
    conversationId: dto.conversationId,
    role: dto.role,
    mode: dto.mode,
    text: dto.text,
    citations: (dto.citations ?? []).map(toChatV2Citation),
    retrievalMeta: dto.retrievalMeta,
    llmMeta: dto.llmMeta,
    createdAt: new Date(dto.createdAt),
  };
}

export function toChatV2Conversation(
  dto: ChatV2ConversationApi,
): ChatV2Conversation {
  return {
    id: dto.id,
    tenantId: dto.tenantId,
    userId: dto.userId,
    title: dto.title,
    scope: dto.scope,
    scopeRefId: dto.scopeRefId,
    channelKindOrigin: dto.channelKindOrigin,
    status: dto.status,
    pinnedAt: dto.pinnedAt ? new Date(dto.pinnedAt) : null,
    createdAt: new Date(dto.createdAt),
    updatedAt: new Date(dto.updatedAt),
  };
}

export function toChatV2ConversationWithMessages(
  dto: ChatV2ConversationWithMessagesApi,
): ChatV2ConversationWithMessages {
  return {
    ...toChatV2Conversation(dto),
    messages: dto.messages.map(toChatV2Message),
  };
}

const CONTEXT_MARKER_RE =
  /\[(?:BLOCK:[a-zA-Z0-9_-]+|CONTRADICTING BLOCK(?::[a-zA-Z0-9_-]+)?|REASONING CHAIN FOR BLOCK [a-zA-Z0-9_-]+|DECISION:[a-zA-Z0-9_-]+)\]/g;

export function stripContextMarkers(text: string): string {
  return text
    .replace(CONTEXT_MARKER_RE, "")
    .replace(/[^\S\n]{2,}/g, " ")
    .replace(/[^\S\n]+([.,;:!?])/g, "$1")
    .replace(/[^\S\n]+\n/g, "\n")
    .trim();
}

export function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "00:00";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
  return `${pad(m)}:${pad(s)}`;
}

export type AssistantTarget =
  | { kind: "assistant" }
  | { kind: "clone"; roleId: string; roleName: string };

export function cloneAnswerToChatV2Message(
  api: AskCloneResponseApi,
): ChatV2Message {
  return {
    id: api.messageId,
    conversationId: api.conversationId,
    role: "assistant",
    mode: "clone_style",
    text: api.text,
    citations: (api.citations ?? [])
      .map(cloneCitationToChatV2Citation)
      .filter((c): c is ChatV2Citation => c !== null),
    retrievalMeta: null,
    llmMeta: {
      refused: api.refused ?? false,
      refusalReason: api.refusalReason ?? null,
    },
    createdAt: new Date(),
  };
}

export function cloneCitationToChatV2Citation(
  api: CloneCitationApi,
): ChatV2Citation | null {
  if (!api.meetingId && !api.meetingTitle) return null;
  return {
    meetingId: api.meetingId ?? "",
    meetingTitle: api.meetingTitle ?? "Источник",
    startMs: api.startMs ?? 0,
    endMs: api.endMs ?? 0,
    snippet: api.snippet ?? "",
  };
}
