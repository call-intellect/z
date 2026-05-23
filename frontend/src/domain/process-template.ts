/**
 * Доменная модель ProcessTemplate (SBA α-7 wave 2).
 *
 * Контракт: `backend/src/modules/processes/dto/processes.dto.ts`.
 *
 * Слои:
 *   - `*Api` — что приходит с бэка (см. `src/api/processes.api.ts`).
 *   - `*Domain` — UI-friendly: Date вместо string, готовые лейблы.
 */

import type {
  DecisionPointApi,
  ListProcessTemplatesResponseApi,
  ProcessHandoffApi,
  ProcessHandoffKindApi,
  ProcessTemplateDefinitionApi,
  ProcessTemplateDetailApi,
  ProcessTemplateListItemApi,
  ProcessTemplateStatusApi,
  ProcessTemplateVersionApi,
  ProcessTemplateVersionSourceApi,
} from '@/api/processes.api';

export type ProcessTemplateStatus = ProcessTemplateStatusApi;
export type ProcessTemplateVersionSource = ProcessTemplateVersionSourceApi;
export type ProcessHandoffKind = ProcessHandoffKindApi;

export const PROCESS_TEMPLATE_STATUS_LABEL: Record<
  ProcessTemplateStatus,
  string
> = {
  active: 'Действует',
  deprecated: 'Устарел',
  archived: 'В архиве',
};

export const PROCESS_TEMPLATE_VERSION_SOURCE_LABEL: Record<
  ProcessTemplateVersionSource,
  string
> = {
  manual: 'Вручную',
  agent: 'AI-агент',
  imported: 'Импорт',
};

export const PROCESS_HANDOFF_KIND_LABEL: Record<ProcessHandoffKind, string> = {
  document: 'Документ',
  data: 'Данные',
  decision: 'Решение',
  physical: 'Физический',
  notification: 'Уведомление',
};

export interface ProcessTemplateListItem {
  id: string;
  name: string;
  summary: string | null;
  category: string | null;
  scope: string | null;
  status: ProcessTemplateStatus;
  currentVersionId: string | null;
  ownerRoleId: string | null;
  ownerPersonId: string | null;
  completeness: number;
  stepsCount: number;
  decisionPointsCount: number;
  handoffsCount: number;
  lastConfirmedAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
}

export interface ProcessTemplateVersionDomain {
  id: string;
  version: number;
  definition: ProcessTemplateDefinitionApi;
  source: ProcessTemplateVersionSource;
  changeNote: string | null;
  publishedById: string | null;
  publishedAt: Date | null;
  createdAt: Date;
}

export interface DecisionPointDomain {
  id: string;
  templateId: string | null;
  name: string;
  condition: string | null;
  branches: Array<{
    name: string;
    description?: string;
    leadsToStepOrder?: number;
  }>;
  decidedByRoleId: string | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProcessHandoffDomain {
  id: string;
  fromTemplateId: string | null;
  toTemplateId: string | null;
  fromRoleId: string | null;
  toRoleId: string | null;
  kind: ProcessHandoffKind;
  payloadDescription: string | null;
  expectedSlaHours: number | null;
  knownFrictionCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProcessTemplateDetail extends ProcessTemplateListItem {
  sourceBlockIds: string[];
  currentVersion: ProcessTemplateVersionDomain | null;
  decisionPoints: DecisionPointDomain[];
  handoffsFrom: ProcessHandoffDomain[];
  handoffsTo: ProcessHandoffDomain[];
}

// ─── mappers ────────────────────────────────────────────────────────

export function mapProcessTemplateListItem(
  api: ProcessTemplateListItemApi,
): ProcessTemplateListItem {
  return {
    ...api,
    lastConfirmedAt: api.lastConfirmedAt ? new Date(api.lastConfirmedAt) : null,
    updatedAt: new Date(api.updatedAt),
    createdAt: new Date(api.createdAt),
  };
}

export function mapProcessTemplateDetail(
  api: ProcessTemplateDetailApi,
): ProcessTemplateDetail {
  return {
    ...mapProcessTemplateListItem(api),
    sourceBlockIds: api.sourceBlockIds,
    currentVersion: api.currentVersion
      ? mapProcessTemplateVersion(api.currentVersion)
      : null,
    decisionPoints: api.decisionPoints.map(mapDecisionPoint),
    handoffsFrom: api.handoffsFrom.map(mapProcessHandoff),
    handoffsTo: api.handoffsTo.map(mapProcessHandoff),
  };
}

export function mapProcessTemplateVersion(
  api: ProcessTemplateVersionApi,
): ProcessTemplateVersionDomain {
  return {
    id: api.id,
    version: api.version,
    definition: api.definition,
    source: api.source,
    changeNote: api.changeNote,
    publishedById: api.publishedById,
    publishedAt: api.publishedAt ? new Date(api.publishedAt) : null,
    createdAt: new Date(api.createdAt),
  };
}

export function mapDecisionPoint(api: DecisionPointApi): DecisionPointDomain {
  return {
    ...api,
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
  };
}

export function mapProcessHandoff(
  api: ProcessHandoffApi,
): ProcessHandoffDomain {
  return {
    ...api,
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
  };
}

export function mapProcessTemplatesList(
  api: ListProcessTemplatesResponseApi,
): {
  items: ProcessTemplateListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
} {
  return {
    items: api.items.map(mapProcessTemplateListItem),
    total: api.total,
    page: api.page,
    limit: api.limit,
    totalPages: api.totalPages,
  };
}
