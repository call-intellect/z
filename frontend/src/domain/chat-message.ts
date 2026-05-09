import type { ChatCitationApi, ChatMessageApi } from '@/api/chat.api';

export type ChatCitationDomain = {
  meetingId: string;
  meetingTitle?: string;
  startMs: number;
  endMs: number;
  speakerName: string | null;
  snippet: string;
};

export type ChatMessageDomain = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: ChatCitationDomain[];
  createdAt: Date;
  /** UI-only: помечен после неудачной отправки. */
  failed?: boolean;
  /** UI-only: индикатор «думает...». */
  pending?: boolean;
};

export function chatCitationFromApi(api: ChatCitationApi): ChatCitationDomain {
  return {
    meetingId: api.meetingId,
    meetingTitle: api.meetingTitle,
    startMs: api.startMs,
    endMs: api.endMs,
    speakerName: null,
    snippet: api.snippet,
  };
}

export function chatMessageFromApi(api: ChatMessageApi): ChatMessageDomain {
  return {
    id: api.id,
    role: api.role,
    content: api.content,
    citations: (api.citations ?? []).map(chatCitationFromApi),
    createdAt: new Date(api.createdAt),
  };
}
