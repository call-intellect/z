import type {
  ChatV2CitationApi,
  ChatV2ConversationApi,
  ChatV2ConversationStatusApi,
  ChatV2ConversationWithMessagesApi,
  ChatV2MessageApi,
  ChatV2MessageRoleApi,
  ChatV2ModeApi,
  ChatV2ScopeApi,
} from '@/api/chat-v2.api';

/**
 * Domain-модели SBA α-5 — Layer 5 Chat-v2 Omnichannel.
 *
 * Преобразование ApiDto → DomainModel:
 *   - даты приводятся к Date;
 *   - перечисления остаются строковыми, лейблы — через хелперы;
 *   - citations — массив (никогда null в domain).
 */

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
  /** ТЗ-4 Ф11 — если блок из загруженного документа, ссылка на него. */
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
  org: 'Вся компания',
  meeting: 'Встреча',
  card: 'Карточка',
  theme: 'Тема',
  entity: 'Сущность',
  personal: 'Личный',
  // Wave 2 polish T6-6b — чат в задаче.
  issue: 'Задача',
};

const MODE_LABEL: Record<ChatV2Mode, string> = {
  factual: 'Факты',
  synthetic: 'Синтез',
  clone_style: 'Клон сотрудника',
};

const STATUS_LABEL: Record<ChatV2ConversationStatus, string> = {
  active: 'Активный',
  archived: 'В архиве',
};

export function chatV2ScopeLabel(scope: ChatV2Scope): string {
  return SCOPE_LABEL[scope] ?? scope;
}

export function chatV2ModeLabel(mode: ChatV2Mode): string {
  return MODE_LABEL[mode] ?? mode;
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

/**
 * #57 — служебные маркеры источников/рассуждений, которые бэкенд НАМЕРЕННО
 * оставляет в тексте ответа ассистента (цитаты парсятся отдельно и показываются
 * блоком «Источники»). Пользователю в самом тексте они не нужны. Покрывает все
 * формы: `[BLOCK:id]`, `[CONTRADICTING BLOCK]`, слитный `[CONTRADICTING BLOCK:id]`,
 * `[REASONING CHAIN FOR BLOCK id]`, `[DECISION:id]`. id-класс — `[a-zA-Z0-9_-]+`.
 * НЕ трогает markdown-ссылки `[текст](url)` и обычный текст в скобках — матчит
 * только конкретные служебные ключевые слова.
 */
const CONTEXT_MARKER_RE =
  /\[(?:BLOCK:[a-zA-Z0-9_-]+|CONTRADICTING BLOCK(?::[a-zA-Z0-9_-]+)?|REASONING CHAIN FOR BLOCK [a-zA-Z0-9_-]+|DECISION:[a-zA-Z0-9_-]+)\]/g;

export function stripContextMarkers(text: string): string {
  return text
    .replace(CONTEXT_MARKER_RE, '')
    // схлопываем пробелы/табы, оставшиеся от вырезанного маркера, НЕ трогая
    // переводы строк (важно для whitespace-pre-wrap поверхностей).
    .replace(/[^\S\n]{2,}/g, ' ')
    // убираем пробел перед знаком препинания, появившийся от выреза.
    .replace(/[^\S\n]+([.,;:!?])/g, '$1')
    // убираем хвостовой пробел перед переводом строки (но НЕ ведущий отступ
    // следующей строки — он может быть значимым для markdown-списков).
    .replace(/[^\S\n]+\n/g, '\n')
    .trim();
}

/** Форматирует mm:ss из миллисекунд. */
export function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '00:00';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
  return `${pad(m)}:${pad(s)}`;
}
