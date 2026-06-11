/**
 * Доменная модель Regulation / Process / Policy (SBA α-7).
 *
 * Контракт: `backend/src/modules/regulations/dto/regulations.dto.ts`.
 *
 * Слои:
 *   - `Regulation*Api` — что приходит с бэка (см. `src/api/regulations.api.ts`).
 *   - `Regulation*Domain` — UI-friendly: Date вместо string, готовые лейблы.
 *
 * Под капотом — 3 разные Prisma-таблицы (Regulation/Process/Policy),
 * объединённые единым DTO с дискриминатором `kind`.
 */

import type {
  ExtractionStatusApi,
  PolicySeverityApi,
  ProcessStepApi,
  RegulationChangeSourceApi,
  RegulationDetailApi,
  RegulationHistoryResponseApi,
  RegulationKindApi,
  RegulationListItemApi,
  RegulationStatusApi,
  RegulationVersionItemApi,
  TrustTierApi,
} from '@/api/regulations.api';

export type RegulationKind = RegulationKindApi;
export type RegulationStatus = RegulationStatusApi;
export type PolicySeverity = PolicySeverityApi;
export type TrustTier = TrustTierApi;
export type ExtractionStatus = ExtractionStatusApi;
export type RegulationChangeSource = RegulationChangeSourceApi;

export const REGULATION_KIND_LABEL: Record<RegulationKind, string> = {
  regulation: 'Регламент',
  process: 'Процесс',
  policy: 'Политика',
  standard: 'Стандарт',
  instruction: 'Инструкция',
};

export const REGULATION_STATUS_LABEL: Record<RegulationStatus, string> = {
  active: 'Действует',
  deprecated: 'Устарел',
  archived: 'В архиве',
};

/** Лейблы статуса извлечения (B2.2). */
export const EXTRACTION_STATUS_LABEL: Record<ExtractionStatus, string> = {
  exists: 'Существует',
  needed: 'Нужен',
  discussed: 'Обсуждается',
};

/** Лейблы источника изменения (B2.5). */
export const REGULATION_CHANGE_SOURCE_LABEL: Record<
  RegulationChangeSource,
  string
> = {
  agent: 'Извлечено Корой',
  manual: 'Изменено вручную',
  imported: 'Импортировано',
};

export const POLICY_SEVERITY_LABEL: Record<PolicySeverity, string> = {
  advisory: 'Рекомендация',
  mandatory: 'Обязательная',
  blocking: 'Критическая',
};

export interface RegulationListItem {
  id: string;
  kind: RegulationKind;
  name: string;
  statement: string | null;
  category: 'regulation' | 'standard' | null;
  severity: PolicySeverity | null;
  scope: string | null;
  status: RegulationStatus;
  ownerPersonId: string | null;
  confidence: number | null;
  trustTier: TrustTier;
  /** Статус извлечения (B2.2). null — поле не пришло с бэка. */
  extractionStatus: ExtractionStatus | null;
  lastConfirmedAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
}

/**
 * Запись считается черновиком/обсуждаемой (B2.3): для неё нельзя показывать
 * lifecycle-статус «Действует».
 */
export function isDraftExtraction(
  extractionStatus: ExtractionStatus | null,
): boolean {
  return extractionStatus === 'needed' || extractionStatus === 'discussed';
}

export interface RegulationDetail extends RegulationListItem {
  contentMd: string;
  sourceBlockIds: string[];
  personSubjectIds: string[];
  currentVersionId: string | null;
  steps?: ProcessStepDomain[];
  supersedesId?: string | null;
}

export interface ProcessStepDomain {
  id: string;
  order: number;
  name: string;
  description: string | null;
  slaMinutes: number | null;
}

export interface RegulationVersion {
  id: string;
  version: number;
  previousVersionId: string | null;
  payload: Record<string, unknown>;
  /**
   * Причина изменения (B2.5). Для process бэк присылает `changeNote` —
   * маппер сводит оба источника в это единое поле.
   */
  changeReason: string | null;
  /** Источник изменения (B2.5). null — поле не пришло. */
  source: RegulationChangeSource | null;
  createdAt: Date;
  createdByUserId: string | null;
}

// ─── mappers ────────────────────────────────────────────────────────

export function mapRegulationListItem(
  api: RegulationListItemApi,
): RegulationListItem {
  return {
    ...api,
    trustTier: api.trustTier ?? 'human',
    extractionStatus: api.extractionStatus ?? null,
    lastConfirmedAt: api.lastConfirmedAt ? new Date(api.lastConfirmedAt) : null,
    updatedAt: new Date(api.updatedAt),
    createdAt: new Date(api.createdAt),
  };
}

export function mapRegulationDetail(api: RegulationDetailApi): RegulationDetail {
  return {
    ...mapRegulationListItem(api),
    contentMd: api.contentMd,
    sourceBlockIds: api.sourceBlockIds,
    personSubjectIds: api.personSubjectIds,
    currentVersionId: api.currentVersionId,
    supersedesId: api.supersedesId ?? null,
    steps: api.steps ? api.steps.map(mapProcessStep) : undefined,
  };
}

export function mapProcessStep(api: ProcessStepApi): ProcessStepDomain {
  return {
    id: api.id,
    order: api.order,
    name: api.name,
    description: api.description,
    slaMinutes: api.slaMinutes,
  };
}

export function mapVersionsFromHistory(
  api: RegulationHistoryResponseApi,
): RegulationVersion[] {
  return api.items.map(mapVersionItem);
}

export function mapVersionItem(api: RegulationVersionItemApi): RegulationVersion {
  return {
    id: api.id,
    version: api.version,
    previousVersionId: api.previousVersionId,
    payload: api.payload,
    // process → changeNote, regulation/policy → changeReason; сводим в одно.
    changeReason: api.changeReason ?? api.changeNote ?? null,
    source: api.source ?? null,
    createdAt: new Date(api.createdAt),
    createdByUserId: api.createdByUserId,
  };
}
