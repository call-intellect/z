/**
 * Доменная модель Idea / IdeaCluster (SBA β-5, ТЗ 2026-05-26 §2).
 *
 * Контракт: `backend/src/modules/ideas/dto/ideas.dto.ts`.
 *
 * Слои:
 *   - `Idea*Api` — что приходит с бэка (см. `src/api/ideas.api.ts`).
 *   - `Idea*Domain` — UI-friendly: Date вместо string, готовые лейблы.
 */

import type {
  IdeaClusterApi,
  IdeaDetailApi,
  IdeaKindApi,
  IdeaListItemApi,
  IdeaStatusApi,
  IdeaSupporterApi,
} from '@/api/ideas.api';

export type IdeaKind = IdeaKindApi;
export type IdeaStatus = IdeaStatusApi;

export type IdeaChipVariant =
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'lavender'
  | 'sand';

export const IDEA_KIND_LABEL: Record<IdeaKind, string> = {
  internal: 'Внутренняя',
  client_request: 'Запрос клиента',
};

export const IDEA_STATUS_LABEL: Record<IdeaStatus, string> = {
  captured: 'Зафиксирована',
  in_discussion: 'Обсуждается',
  accepted: 'Принята',
  in_progress: 'В работе',
  shipped: 'Выпущена',
  rejected: 'Отклонена',
  archived: 'В архиве',
};

export const IDEA_STATUS_CHIP: Record<IdeaStatus, IdeaChipVariant> = {
  captured: 'sand',
  in_discussion: 'info',
  accepted: 'lavender',
  in_progress: 'warning',
  shipped: 'success',
  rejected: 'danger',
  archived: 'sand',
};

/**
 * Разрешённые переходы статусов (UI-логика — соответствует серверной
 * валидации в IdeasService.changeStatus). Если статус терминальный
 * (`shipped` / `archived`) — пустой массив.
 */
export const IDEA_STATUS_TRANSITIONS: Record<IdeaStatus, IdeaStatus[]> = {
  captured: ['in_discussion', 'accepted', 'rejected'],
  in_discussion: ['accepted', 'rejected'],
  accepted: ['in_progress', 'rejected'],
  in_progress: ['shipped', 'rejected'],
  shipped: [],
  rejected: ['archived'],
  archived: [],
};

export interface IdeaSupporter {
  kind: 'person' | 'customer';
  entityId: string;
  firstSupportedAt: Date;
  blockId?: string;
}

export interface IdeaListItem {
  id: string;
  kind: IdeaKind;
  status: IdeaStatus;
  statement: string;
  rationale: string | null;
  weight: number;
  supporterCount: number;
  clusterId: string | null;
  firstProposedAt: Date;
  lastDiscussedAt: Date;
  createdByUserId: string | null;
  /** Goals OKR v2 — цель, которую двигает эта гипотеза (null = не привязана). */
  goalId: string | null;
}

export interface IdeaDetail extends IdeaListItem {
  supporters: IdeaSupporter[];
  sourceBlockIds: string[];
  personSubjectIds: string[];
  statusChangedAt: Date | null;
  statusChangedByUserId: string | null;
  statusReason: string | null;
  confidence: number;
  dataClass: string;
}

export interface IdeaCluster {
  id: string;
  name: string;
  description: string | null;
  ideaIds: string[];
  ideaCount: number;
  clusterWeight: number;
  createdAt: Date;
  updatedAt: Date;
}

// ─── mappers ────────────────────────────────────────────────────────

export function mapIdeaSupporter(api: IdeaSupporterApi): IdeaSupporter {
  return {
    kind: api.kind,
    entityId: api.entityId,
    firstSupportedAt: new Date(api.firstSupportedAt),
    blockId: api.blockId,
  };
}

export function mapIdeaListItem(api: IdeaListItemApi): IdeaListItem {
  return {
    id: api.id,
    kind: api.kind,
    status: api.status,
    statement: api.statement,
    rationale: api.rationale,
    weight: api.weight,
    supporterCount: api.supporterCount,
    clusterId: api.clusterId,
    firstProposedAt: new Date(api.firstProposedAt),
    lastDiscussedAt: new Date(api.lastDiscussedAt),
    createdByUserId: api.createdByUserId,
    goalId: api.goalId ?? null,
  };
}

/**
 * #80 — единая точка построения ссылки на деталь идеи. Используется виджетами
 * дашборда и /me; ведёт на отдельный роут /ideas/[id] (а не на inline master-detail).
 */
export function ideaHref(id: string): string {
  return `/ideas/${encodeURIComponent(id)}`;
}

export function mapIdeaDetail(api: IdeaDetailApi): IdeaDetail {
  return {
    ...mapIdeaListItem(api),
    supporters: api.supporters.map(mapIdeaSupporter),
    sourceBlockIds: api.sourceBlockIds,
    personSubjectIds: api.personSubjectIds,
    statusChangedAt: api.statusChangedAt ? new Date(api.statusChangedAt) : null,
    statusChangedByUserId: api.statusChangedByUserId,
    statusReason: api.statusReason,
    confidence: api.confidence,
    dataClass: api.dataClass,
  };
}

export function mapIdeaCluster(api: IdeaClusterApi): IdeaCluster {
  return {
    id: api.id,
    name: api.name,
    description: api.description,
    ideaIds: api.ideaIds,
    ideaCount: api.ideaIds.length,
    clusterWeight: api.clusterWeight,
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
  };
}
