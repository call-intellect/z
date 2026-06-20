import type {
  ExtractionStatusApi,
  PolicySeverityApi,
  ProcessStepApi,
  RegulationChangeSourceApi,
  RegulationDetailApi,
  RegulationHistoryResponseApi,
  RegulationKindApi,
  RegulationListItemApi,
  RegulationSourceItemApi,
  RegulationSourcesApi,
  RegulationStatusApi,
  RegulationSummaryApi,
  RegulationVersionItemApi,
  TrustTierApi,
} from "@/api/regulations.api";
import {
  mapPreviewToProvenanceRef,
  type ProvenanceRef,
} from "@/domain/provenance";

export type RegulationKind = RegulationKindApi;
export type RegulationStatus = RegulationStatusApi;
export type PolicySeverity = PolicySeverityApi;
export type TrustTier = TrustTierApi;
export type ExtractionStatus = ExtractionStatusApi;
export type RegulationChangeSource = RegulationChangeSourceApi;

export const REGULATION_KIND_LABEL: Record<RegulationKind, string> = {
  regulation: "Регламент",
  process: "Процесс",
  policy: "Политика",
  standard: "Стандарт",
  instruction: "Инструкция",
};

export const REGULATION_STATUS_LABEL: Record<RegulationStatus, string> = {
  active: "Действует",
  deprecated: "Устарел",
  archived: "В архиве",
};

export const EXTRACTION_STATUS_LABEL: Record<ExtractionStatus, string> = {
  exists: "Существует",
  needed: "Нужен",
  discussed: "Обсуждается",
};

export const REGULATION_CHANGE_SOURCE_LABEL: Record<
  RegulationChangeSource,
  string
> = {
  agent: "Извлечено Корой",
  manual: "Изменено вручную",
  imported: "Импортировано",
};

export const POLICY_SEVERITY_LABEL: Record<PolicySeverity, string> = {
  advisory: "Рекомендация",
  mandatory: "Обязательная",
  blocking: "Критическая",
};

export interface RegulationListItem {
  id: string;
  kind: RegulationKind;
  name: string;
  statement: string | null;
  category: "regulation" | "standard" | null;
  severity: PolicySeverity | null;
  scope: string | null;
  status: RegulationStatus;
  ownerPersonId: string | null;
  confidence: number | null;
  trustTier: TrustTier;
  extractionStatus: ExtractionStatus | null;
  provenancePreview?: ProvenanceRef | null;
  lastConfirmedAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
}

export function isDraftExtraction(
  extractionStatus: ExtractionStatus | null,
): boolean {
  return extractionStatus === "needed" || extractionStatus === "discussed";
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
  changeReason: string | null;
  source: RegulationChangeSource | null;
  createdAt: Date;
  createdByUserId: string | null;
}

export function mapRegulationListItem(
  api: RegulationListItemApi,
): RegulationListItem {
  return {
    ...api,
    trustTier: api.trustTier ?? "human",
    extractionStatus: api.extractionStatus ?? null,
    provenancePreview: mapPreviewToProvenanceRef(
      api.previewQuote,
      api.previewSourceRef,
    ),
    lastConfirmedAt: api.lastConfirmedAt ? new Date(api.lastConfirmedAt) : null,
    updatedAt: new Date(api.updatedAt),
    createdAt: new Date(api.createdAt),
  };
}

export function mapRegulationDetail(
  api: RegulationDetailApi,
): RegulationDetail {
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

export interface RegulationSource {
  blockId: string;
  quote: string;
  startMs: number | null;
  meeting: { id: string; title: string; date: Date } | null;
  deepLink: string | null;
}

export function mapRegulationSource(
  api: RegulationSourceItemApi,
): RegulationSource {
  const startMs = api.startMs ?? null;
  const meeting = api.meeting
    ? {
        id: api.meeting.id,
        title: api.meeting.title,
        date: new Date(api.meeting.date),
      }
    : null;
  return {
    blockId: api.blockId,
    quote: api.quote,
    startMs,
    meeting,
    deepLink: meeting
      ? `/meetings/${meeting.id}?t=${Math.max(0, Math.round((startMs ?? 0) / 1000))}`
      : null,
  };
}

export function mapRegulationSources(
  api: RegulationSourcesApi,
): RegulationSource[] {
  return api.items.map(mapRegulationSource);
}

export interface RegulationSummary {
  regulations: number;
  processes: number;
  instructions: number;
  policies: number;
  weekDelta: number;
  total: number;
  /** Ф5 — kill-switch редизайна (дефолт true, если бэк не прислал). */
  redesignEnabled: boolean;
}

export function mapRegulationSummary(
  api: RegulationSummaryApi,
): RegulationSummary {
  const regulations = api.regulations ?? 0;
  const processes = api.processes ?? 0;
  const instructions = api.instructions ?? 0;
  const policies = api.policies ?? 0;
  return {
    regulations,
    processes,
    instructions,
    policies,
    weekDelta: api.weekDelta ?? 0,
    total: regulations + processes + instructions + policies,
    redesignEnabled: api.redesignEnabled ?? true,
  };
}

export function mapVersionItem(
  api: RegulationVersionItemApi,
): RegulationVersion {
  return {
    id: api.id,
    version: api.version,
    previousVersionId: api.previousVersionId,
    payload: api.payload,
    changeReason: api.changeReason ?? api.changeNote ?? null,
    source: api.source ?? null,
    createdAt: new Date(api.createdAt),
    createdByUserId: api.createdByUserId,
  };
}
