import type {
  ConflictItemApi,
  ConflictResolutionApi,
  ConflictStatusApi,
  CurationDecisionApi,
  CurationDecisionTypeApi,
  CurationItemApi,
  CurationItemDetailApi,
  CurationItemStatusApi,
  CurationLevelApi,
  CurationSettingsApi,
} from '@/api/curation.api';

/**
 * Domain-модели Слоя 4 (SBA α-4). Перевод ApiDto → DomainModel:
 *   - даты приводятся к `Date`;
 *   - перечисления оставляем строковыми (TypeScript-литералы), но даём
 *     русские лейблы через хелперы;
 *   - вычисляемые флаги для UI (isPending, isStale).
 */

export type CurationLevel = CurationLevelApi;
export type CurationItemStatus = CurationItemStatusApi;
export type CurationDecisionType = CurationDecisionTypeApi;
export type ConflictStatus = ConflictStatusApi;
export type ConflictResolution = ConflictResolutionApi;

const LEVEL_LABEL: Record<CurationLevel, string> = {
  light: 'Простая проверка',
  deep: 'Подробная проверка',
};
const STATUS_LABEL: Record<CurationItemStatus, string> = {
  pending: 'На проверке',
  decided: 'Решение принято',
  expired: 'Просрочена',
  cancelled: 'Отменена',
};
const DECISION_LABEL: Record<CurationDecisionType, string> = {
  approve: 'Одобрить',
  reject: 'Отклонить',
  approve_with_edits: 'Одобрить с правками',
  split: 'Разделить',
  merge: 'Объединить',
  supersede: 'Заменить',
  merge_categories: 'Слить категории',
  escalate: 'Передать другому',
};
const CONFLICT_STATUS_LABEL: Record<ConflictStatus, string> = {
  open: 'Открыт',
  resolved: 'Разрешён',
  dismissed: 'Отклонён',
};
const CONFLICT_RESOLUTION_LABEL: Record<ConflictResolution, string> = {
  accept_new: 'Принять новую',
  keep_old: 'Сохранить старую',
  merge: 'Объединить',
  evolving: 'Эволюция',
};

export function curationLevelLabel(level: CurationLevel): string {
  return LEVEL_LABEL[level] ?? level;
}
export function curationStatusLabel(status: CurationItemStatus): string {
  return STATUS_LABEL[status] ?? status;
}
export function curationDecisionLabel(t: CurationDecisionType): string {
  return DECISION_LABEL[t] ?? t;
}
export function conflictStatusLabel(s: ConflictStatus): string {
  return CONFLICT_STATUS_LABEL[s] ?? s;
}
export function conflictResolutionLabel(r: ConflictResolution): string {
  return CONFLICT_RESOLUTION_LABEL[r] ?? r;
}

/**
 * RU-подпись характера связи конфликта. Значения приходят из block-linker
 * (enum IdeaBlockLinkType); на практике для конфликта это почти всегда
 * `contradicts`. Неизвестное — нейтральная подпись, НЕ сырой код.
 */
const CONFLICT_RELATION_LABEL: Record<string, string> = {
  contradicts: 'Противоречие',
  develops: 'Развитие',
  causes: 'Причина',
  consequences_of: 'Следствие',
  shares_topic: 'Общая тема',
  shares_entity: 'Общая сущность',
  question_answered_by: 'Ответ на вопрос',
};
export function conflictRelationLabel(relationType: string): string {
  return CONFLICT_RELATION_LABEL[relationType.toLowerCase()] ?? 'Связь карточек';
}

/**
 * Человекочитаемое объяснение, ПОЧЕМУ карточка попала на проверку.
 *
 * `triageReason` на бэке — это технический объект с порогами
 * (`autoThreshold`, `deepReviewThreshold`, `effectiveConfidence`,
 * `conflictSignal`, `criticalType`…), который пользователю показывать нельзя:
 * это внутренние числа и английские ключи. Здесь сводим его к одной понятной
 * фразе на русском. Источник полей — `curation.service.ts` (`triageReason`,
 * `via: 'user_correction' | 'recordDecision'`, `reason: 'stale' | 'audit_sample'`).
 */
export function triageReasonSummary(
  reason: Record<string, unknown> | null | undefined,
): string {
  const r = reason ?? {};
  const via = typeof r.via === 'string' ? r.via : null;
  const tag = typeof r.reason === 'string' ? r.reason : null;

  if (via === 'user_correction') {
    return 'Сотрудник предложил правку этой карточки — нужно подтвердить или отклонить изменение.';
  }
  if (via === 'recordDecision') {
    return 'Решение по карточке зафиксировано из интерфейса.';
  }
  if (tag === 'stale') {
    return 'Карточка давно не обновлялась и могла устареть — стоит пересмотреть её актуальность.';
  }
  if (tag === 'audit_sample') {
    return 'Выборочная проверка качества: карточку сохранил ИИ автоматически, но мы показываем её человеку для контроля.';
  }

  if (r.criticalType === true) {
    return 'Это важный тип знания — такие карточки всегда проверяет человек, прежде чем они попадут в память компании.';
  }

  const conflict = typeof r.conflictSignal === 'string' ? r.conflictSignal : 'none';
  if (conflict === 'hard') {
    return 'Карточка противоречит уже сохранённому знанию — нужно решить, какой из вариантов верный.';
  }
  if (conflict === 'soft') {
    return 'Карточка может пересекаться с уже сохранённым знанием — стоит проверить, нет ли дубля или противоречия.';
  }

  const confidence =
    typeof r.confidence === 'number'
      ? r.confidence
      : typeof r.effectiveConfidence === 'number'
        ? r.effectiveConfidence
        : null;
  const deepThreshold =
    typeof r.deepReviewThreshold === 'number' ? r.deepReviewThreshold : null;
  if (confidence !== null && deepThreshold !== null && confidence < deepThreshold) {
    return 'ИИ не уверен в этой карточке — поэтому нужна подробная проверка человеком, прежде чем сохранять её.';
  }

  return 'ИИ не до конца уверен в карточке, поэтому отправил её вам на проверку, а не сохранил автоматически.';
}

export interface CurationItem {
  id: string;
  tenantId: string;
  resourceType: string;
  resourceId: string;
  level: CurationLevel;
  status: CurationItemStatus;
  triageReason: Record<string, unknown>;
  proposedPayload: Record<string, unknown>;
  assignedToUserId: string | null;
  candidateCuratorIds: string[];
  createdAt: Date;
  decidedAt: Date | null;
  expiresAt: Date | null;
  /** Уверенность (если фигурирует в triageReason.confidence). */
  confidence: number | null;
  /** Это карточка-stale (`triageReason.reason === 'stale'`). */
  isStale: boolean;
}

export interface CurationDecision {
  id: string;
  curationItemId: string;
  decisionType: CurationDecisionType;
  payload: Record<string, unknown>;
  reasoning: string | null;
  reviewerUserId: string;
  createdAt: Date;
}

export interface CurationItemDetail extends CurationItem {
  decisions: CurationDecision[];
  relatedConflictIds: string[];
}

export interface ConflictItem {
  id: string;
  tenantId: string;
  resourceType: string;
  existingId: string;
  newId: string;
  evidence: Record<string, unknown>;
  relationType: string;
  detectedBy: string;
  status: ConflictStatus;
  resolution: ConflictResolution | null;
  evolvingMeta: {
    existingValidUntil: string | null;
    newValidFrom: string | null;
  } | null;
  resolvedByUserId: string | null;
  resolvedAt: Date | null;
  reasoning: string | null;
  createdAt: Date;
}

export interface CurationSettings {
  autoThreshold: number;
  deepReviewThreshold: number;
  criticalTypes: string[];
  itemExpiryDays: number;
}

export function mapCurationItem(api: CurationItemApi): CurationItem {
  const reason = api.triageReason ?? {};
  const conf = typeof reason.confidence === 'number' ? reason.confidence : null;
  const isStale = reason.reason === 'stale';
  return {
    id: api.id,
    tenantId: api.tenantId,
    resourceType: api.resourceType,
    resourceId: api.resourceId,
    level: api.level,
    status: api.status,
    triageReason: reason,
    proposedPayload: api.proposedPayload ?? {},
    assignedToUserId: api.assignedToUserId,
    candidateCuratorIds: api.candidateCuratorIds,
    createdAt: new Date(api.createdAt),
    decidedAt: api.decidedAt ? new Date(api.decidedAt) : null,
    expiresAt: api.expiresAt ? new Date(api.expiresAt) : null,
    confidence: conf,
    isStale,
  };
}

export function mapCurationDecision(api: CurationDecisionApi): CurationDecision {
  return {
    id: api.id,
    curationItemId: api.curationItemId,
    decisionType: api.decisionType,
    payload: api.payload ?? {},
    reasoning: api.reasoning,
    reviewerUserId: api.reviewerUserId,
    createdAt: new Date(api.createdAt),
  };
}

export function mapCurationItemDetail(
  api: CurationItemDetailApi,
): CurationItemDetail {
  return {
    ...mapCurationItem(api),
    decisions: api.decisions.map(mapCurationDecision),
    relatedConflictIds: api.relatedConflictIds,
  };
}

export function mapConflictItem(api: ConflictItemApi): ConflictItem {
  let evolvingMeta: ConflictItem['evolvingMeta'] = null;
  if (api.evolvingMeta) {
    const m = api.evolvingMeta as Record<string, unknown>;
    evolvingMeta = {
      existingValidUntil:
        typeof m.existingValidUntil === 'string' ? m.existingValidUntil : null,
      newValidFrom: typeof m.newValidFrom === 'string' ? m.newValidFrom : null,
    };
  }
  return {
    id: api.id,
    tenantId: api.tenantId,
    resourceType: api.resourceType,
    existingId: api.existingId,
    newId: api.newId,
    evidence: api.evidence ?? {},
    relationType: api.relationType,
    detectedBy: api.detectedBy,
    status: api.status,
    resolution: api.resolution,
    evolvingMeta,
    resolvedByUserId: api.resolvedByUserId,
    resolvedAt: api.resolvedAt ? new Date(api.resolvedAt) : null,
    reasoning: api.reasoning,
    createdAt: new Date(api.createdAt),
  };
}

export function mapCurationSettings(api: CurationSettingsApi): CurationSettings {
  return {
    autoThreshold: api.autoThreshold,
    deepReviewThreshold: api.deepReviewThreshold,
    criticalTypes: api.criticalTypes,
    itemExpiryDays: api.itemExpiryDays,
  };
}
