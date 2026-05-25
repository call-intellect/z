/**
 * Domain (UiModel) для entity-graph (G.3 KC-Temporal, 2026-05-25).
 *
 * Маппинг ApiDto → UiModel: даты как Date, confidence как percent (0..100),
 * человекочитаемые лейблы relationType и периодов.
 */

import type {
  EntityGraphEdgeApi,
  EntityGraphEvidenceApi,
  EntityGraphNodeApi,
  EntityGraphResultApi,
} from '@/api/entities-graph.api';

export interface EntityGraphNode {
  id: string;
  entityType: string;
  /** Лейбл для UI = canonicalName. */
  label: string;
  depth: number;
  /** Является ли узел центром графа (depth=0). */
  isCenter: boolean;
}

export interface EntityGraphEvidence {
  blockId: string;
  blockName: string;
  quote: string;
  sourceTimestamp: Date | null;
}

export interface EntityGraphEdge {
  edgeId: string;
  from: string;
  to: string;
  relationType: string;
  /** Человекочитаемый лейбл для tooltip / sidebar. */
  relationLabel: string;
  /** 0..1 (исходный), сохраняем для расчётов цвета линии. */
  confidence: number;
  /** 0..100 для UI бейджей. */
  confidencePercent: number;
  attributes: Record<string, unknown> | null;
  validFrom: Date;
  validUntil: Date | null;
  /** true, если связь больше не действует. */
  isExpired: boolean;
  /** Короткая человекочитаемая строка периода действия — для tooltip. */
  periodLabel: string;
  evidence: EntityGraphEvidence[];
}

export interface EntityGraph {
  center: { id: string; entityType: string; label: string };
  nodes: EntityGraphNode[];
  edges: EntityGraphEdge[];
  truncated: boolean;
}

// ────────────────────── Mappers ─────────────────────────────────────

function formatDate(d: Date): string {
  return d.toLocaleDateString('ru-RU', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function buildPeriodLabel(validFrom: Date, validUntil: Date | null): string {
  if (!validUntil) {
    return `с ${formatDate(validFrom)} — действует сейчас`;
  }
  return `${formatDate(validFrom)} — ${formatDate(validUntil)}`;
}

const RELATION_LABELS_RU: Record<string, string> = {
  works_at: 'работает в',
  works_with: 'работает с',
  reports_to: 'подчиняется',
  manages: 'руководит',
  participates_in: 'участвует в',
  owns: 'владеет',
  uses: 'использует',
  blocks: 'блокирует',
  depends_on: 'зависит от',
  related_to: 'связан с',
  contradicts: 'противоречит',
  supersedes: 'заменяет',
  caused_by: 'вызвано',
  causes: 'вызывает',
  mentions: 'упоминает',
};

function relationLabelRu(relationType: string): string {
  return RELATION_LABELS_RU[relationType] ?? relationType;
}

export function mapEntityGraphNode(
  centerId: string,
  api: EntityGraphNodeApi,
): EntityGraphNode {
  return {
    id: api.id,
    entityType: api.entityType,
    label: api.name,
    depth: api.depth,
    isCenter: api.id === centerId,
  };
}

export function mapEntityGraphEvidence(
  api: EntityGraphEvidenceApi,
): EntityGraphEvidence {
  return {
    blockId: api.blockId,
    blockName: api.blockName,
    quote: api.quote,
    sourceTimestamp: api.sourceTimestamp ? new Date(api.sourceTimestamp) : null,
  };
}

export function mapEntityGraphEdge(api: EntityGraphEdgeApi): EntityGraphEdge {
  const validFrom = new Date(api.validFrom);
  const validUntil = api.validUntil ? new Date(api.validUntil) : null;
  const now = Date.now();
  const isExpired = validUntil !== null && validUntil.getTime() < now;
  return {
    edgeId: api.edgeId,
    from: api.from,
    to: api.to,
    relationType: api.relationType,
    relationLabel: relationLabelRu(api.relationType),
    confidence: api.confidence,
    confidencePercent: Math.round(Math.max(0, Math.min(1, api.confidence)) * 100),
    attributes: api.attributes,
    validFrom,
    validUntil,
    isExpired,
    periodLabel: buildPeriodLabel(validFrom, validUntil),
    evidence: api.evidence.map(mapEntityGraphEvidence),
  };
}

export function mapEntityGraph(api: EntityGraphResultApi): EntityGraph {
  return {
    center: {
      id: api.center.id,
      entityType: api.center.entityType,
      label: api.center.name,
    },
    nodes: api.nodes.map((n) => mapEntityGraphNode(api.center.id, n)),
    edges: api.edges.map(mapEntityGraphEdge),
    truncated: api.truncated,
  };
}

/**
 * Цвет линии ребра в зависимости от confidence — для UI визуализации.
 * 0..0.4 — красный, 0.4..0.7 — янтарный, 0.7..1.0 — мятный (бренд Z).
 */
export function edgeColorByConfidence(confidence: number): string {
  if (confidence < 0.4) return '#F87171'; // red-400
  if (confidence < 0.7) return '#FBBF24'; // amber-400
  return '#5EEAD4'; // teal-300 (mint accent)
}
