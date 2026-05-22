/**
 * SBA γ-1 — DomainModel клона (Clone API).
 *
 * Слой ApiDto → DomainModel: фронт работает только с CloneAnswer.
 * UiModel формируется в компоненте.
 */

import type {
  AskCloneResponseApi,
  CloneCitationApi,
} from '../api/clones.api';

export interface CloneCitation {
  blockId: string;
  meetingId: string | null;
  meetingTitle: string | null;
  startMs: number | null;
  endMs: number | null;
  snippet: string | null;
}

export interface CloneAnswer {
  conversationId: string;
  messageId: string;
  text: string;
  citations: CloneCitation[];
  isOwner: boolean;
}

export function mapCloneCitation(api: CloneCitationApi): CloneCitation {
  return {
    blockId: api.blockId,
    meetingId: api.meetingId ?? null,
    meetingTitle: api.meetingTitle ?? null,
    startMs: api.startMs ?? null,
    endMs: api.endMs ?? null,
    snippet: api.snippet ?? null,
  };
}

export function mapCloneAnswer(api: AskCloneResponseApi): CloneAnswer {
  return {
    conversationId: api.conversationId,
    messageId: api.messageId,
    text: api.text,
    citations: api.citations.map(mapCloneCitation),
    isOwner: api.isOwner,
  };
}
