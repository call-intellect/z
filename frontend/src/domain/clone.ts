/**
 * SBA γ-1 — DomainModel клона (Clone API).
 *
 * Слой ApiDto → DomainModel: фронт работает только с CloneAnswer.
 * UiModel формируется в компоненте.
 */

import type {
  AskCloneResponseApi,
  CloneCitationApi,
  CloneConversationListItemApi,
  CloneListItemApi,
  CloneVersionApi,
} from '../api/clones.api';
import type { MyCloneAccessResponseApi } from '../api/me-clone-access.api';

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
  /**
   * Фаза 1 «clone reliability hardening» — клон отказался отвечать
   * (анти-deepfake). По умолчанию false.
   */
  refused: boolean;
  /** Машинно-читаемая причина отказа (например, `'topic_starved'`). */
  refusalReason: string | null;
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
    refused: api.refused ?? false,
    refusalReason: api.refusalReason ?? null,
  };
}

// ─────────── ТЗ 2026-05-26 §2.7 — диалоги member'а с клоном ───────────

/**
 * UiModel одного диалога в боковой панели чата клона
 * (см. CloneConversationListItemApi).
 *
 * `lastMessageAt` уже распарсен в Date — компонент сам форматирует
 * («сегодня 14:23» / «вчера» / «23 мая»).
 */
export interface CloneConversationUiItem {
  id: string;
  title: string | null;
  lastMessageAt: Date;
  createdAt: Date;
  messageCount: number;
}

export function mapCloneConversation(
  api: CloneConversationListItemApi,
): CloneConversationUiItem {
  return {
    id: api.id,
    title: api.title,
    lastMessageAt: new Date(api.lastMessageAt),
    createdAt: new Date(api.createdAt),
    messageCount: api.messageCount,
  };
}

// ─────────── ТЗ 2026-05-26 §2.6 — карта моих грантов на клонов ───────────

/**
 * UiModel результата `/me/clone-access`.
 *
 * Внутри держит два Set'а для O(1) проверки доступа.  Метод `has(...)`
 * совпадает по сигнатуре с тем, что ожидает `CloneCard` / `CloneChatClient`.
 */
export interface MyCloneAccessMap {
  /** ISO момент ответа сервера. */
  fetchedAt: Date;
  /** roleId-ы активных role-грантов. */
  roleClones: Set<string>;
  /** personId-ы активных person-грантов. */
  personClones: Set<string>;
  has(cloneType: 'role' | 'person', cloneRefId: string): boolean;
}

export function mapMyCloneAccess(
  api: MyCloneAccessResponseApi,
): MyCloneAccessMap {
  const roleSet = new Set(api.roleClones);
  const personSet = new Set(api.personClones);
  return {
    fetchedAt: new Date(api.fetchedAt),
    roleClones: roleSet,
    personClones: personSet,
    has(cloneType, cloneRefId) {
      return cloneType === 'role'
        ? roleSet.has(cloneRefId)
        : personSet.has(cloneRefId);
    },
  };
}

/** Локализованная человеко-читаемая причина отказа клона отвечать. */
export function cloneRefusalReasonRu(reason: string | null | undefined): string {
  switch (reason) {
    case 'topic_starved':
      return 'В архиве недостаточно обсуждений по этой теме — клон не может ответить с опорой на источники.';
    default:
      return 'Клон отказался отвечать на этот вопрос.';
  }
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
  /**
   * Clones=Roles Ф2 — три состояния: `active`/`superseded`/`pending_rebuild`.
   * UI на /clones отдаёт только `active`, но pending_rebuild может прилететь,
   * если бэк отдал его в выборке — рисуем бейдж «Клон обновляется».
   */
  status: 'active' | 'superseded' | 'pending_rebuild';
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
  status: 'active' | 'superseded' | 'pending_rebuild';
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
