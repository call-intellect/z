/**
 * SBA γ-1 — DomainModel клона (Clone API).
 *
 * Слой ApiDto → DomainModel: фронт работает только с CloneAnswer.
 * UiModel формируется в компоненте.
 */

import type {
  AskCloneResponseApi,
  CloneCitationApi,
  CloneListItemApi,
  CloneVersionApi,
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

// ─────────── Clones=Roles Ф4 — list & history (DomainModel) ───────────

/**
 * UiModel для карточки клона на `/clones`.
 *
 * confidence — в DB 0..1, UI рисует процент. lastBuildAt уже распарсенный
 * `Date`, чтобы локализация форматирования была в компонентах.
 */
export interface CloneListUiItem {
  personaId: string;
  roleId: string;
  roleName: string;
  departmentName: string | null;
  departmentId: string | null;
  version: number;
  publicName: string;
  status: 'active' | 'superseded';
  bearerName: string | null;
  bearerPersonId: string | null;
  /** 0..100 — для прогресс-бара. */
  confidencePct: number;
  traitsCount: number;
  lastBuildAt: Date;
}

export function mapCloneListItem(api: CloneListItemApi): CloneListUiItem {
  return {
    personaId: api.personaId,
    roleId: api.roleId,
    roleName: api.roleName,
    departmentName: api.departmentName,
    departmentId: api.departmentId,
    version: api.version,
    publicName: api.publicName,
    status: api.status,
    bearerName: api.currentBearer?.personName ?? null,
    bearerPersonId: api.currentBearer?.personId ?? null,
    confidencePct: Math.round((api.confidence ?? 0) * 100),
    traitsCount: api.traitsCount,
    lastBuildAt: new Date(api.lastBuildAt),
  };
}

export interface CloneVersionUiItem {
  personaId: string;
  roleId: string;
  version: number;
  publicName: string;
  status: 'active' | 'superseded';
  bearerName: string | null;
  bearerPersonId: string | null;
  validFrom: Date;
  validUntil: Date | null;
  confidencePct: number;
  traitsCount: number;
}

export function mapCloneVersion(api: CloneVersionApi): CloneVersionUiItem {
  return {
    personaId: api.personaId,
    roleId: api.roleId,
    version: api.version,
    publicName: api.publicName,
    status: api.status,
    bearerName: api.bearer?.personName ?? null,
    bearerPersonId: api.bearer?.personId ?? null,
    validFrom: new Date(api.validFrom),
    validUntil: api.validUntil ? new Date(api.validUntil) : null,
    confidencePct: Math.round((api.confidence ?? 0) * 100),
    traitsCount: api.traitsCount,
  };
}
