import { z } from 'zod';

/**
 * DTO Фазы 3: связи блоков, связи сущностей, BFS-обход графа.
 */

export interface BlockLinkSideDto {
  /** id блока на «той» стороне (не текущего). */
  blockId: string;
  name: string;
  criticalQuestion: string;
  signalType: string;
}

export interface BlockLinkItemDto {
  id: string;
  fromBlockId: string;
  toBlockId: string;
  relationType: string;
  confidence: number;
  explanation: string;
  status: string;
  createdBy: string;
  createdAt: string;
  /** Денормализованный «другой конец» — для UI. */
  other: BlockLinkSideDto;
}

export interface BlockLinksResultDto {
  outgoing: BlockLinkItemDto[];
  incoming: BlockLinkItemDto[];
}

export interface EntityLinkSideDto {
  entityId: string;
  type: string;
  canonicalName: string;
}

export interface EntityLinkItemDto {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  relationType: string;
  confidence: number;
  explanation: string;
  status: string;
  createdBy: string;
  createdAt: string;
  other: EntityLinkSideDto;
}

export interface EntityLinksResultDto {
  outgoing: EntityLinkItemDto[];
  incoming: EntityLinkItemDto[];
}

// ─────────────────────── BFS-обход графа ────────────────────────────────

export const GraphNeighborsQuerySchema = z.object({
  nodeType: z.enum(['block', 'entity']),
  id: z.string().min(1),
  depth: z.coerce.number().int().min(1).max(3).default(1),
});

export type GraphNeighborsQuery = z.infer<typeof GraphNeighborsQuerySchema>;

export interface GraphNodeDto {
  id: string;
  type: 'block' | 'entity';
  label: string;
  depth: number;
}

export interface GraphEdgeDto {
  from: string;
  to: string;
  /** 'block-link' | 'entity-link' | 'block-entity' (через IdeaBlockEntity). */
  type: string;
  /** Семантический тип связи (relationType из IdeaBlockLink/EntityLink) или 'mentions'. */
  label: string;
  confidence?: number;
}

// ─────────────────────── G.3 (KC-Temporal): Entity Graph ─────────────────

/**
 * KC-Temporal G.3 (2026-05-25) — query schema для
 * `GET /api/v1/knowledge/entities/:id/graph?depth=1..3`.
 *
 * Возвращает богатый граф для UI «что система знает про X»: соседи на N шагов
 * + rich-edge атрибуты (attributes / validFrom / validUntil / confidence) +
 * top-3 evidence (цитаты из IdeaBlock'ов-источников).
 */
export const EntityGraphQuerySchema = z.object({
  depth: z.coerce.number().int().min(1).max(3).default(2),
});

export type EntityGraphQuery = z.infer<typeof EntityGraphQuerySchema>;

/** Узел entity-графа (только Entity-узлы, IdeaBlock на этом graph'е не возвращаются). */
export interface EntityGraphNodeDto {
  id: string;
  type: 'entity';
  /** Семантический type сущности (person/client/project/...) — для иконок UI. */
  entityType: string;
  name: string;
  /** Глубина от center'а (0 — сам center). */
  depth: number;
}

/** Top-N evidence для ребра — для UI «Как мы это узнали». */
export interface EntityGraphEvidenceDto {
  blockId: string;
  /** Имя/заголовок блока (для ссылки). */
  blockName: string;
  /** Цитата из IdeaBlockEvidence (или trustedAnswer как fallback). */
  quote: string;
  /** ISO. Если у evidence нет sourceTimestamp — block.createdAt. */
  sourceTimestamp: string | null;
}

/** Богатое ребро entity-графа. */
export interface EntityGraphEdgeDto {
  /** EntityLink.id — используется UI как селектор и для mark-wrong. */
  edgeId: string;
  from: string;
  to: string;
  relationType: string;
  confidence: number;
  /** Произвольные атрибуты (role, share, since, intensity, ...) — KC-Temporal W3.1. */
  attributes: Record<string, unknown> | null;
  /** ISO. */
  validFrom: string;
  /** ISO. null = действует до сих пор. */
  validUntil: string | null;
  /** Top-3 evidence (по recency). Пусто, если у ребра нет sourceBlockIds. */
  evidence: EntityGraphEvidenceDto[];
}

export interface EntityGraphResultDto {
  center: { id: string; type: 'entity'; entityType: string; name: string };
  nodes: EntityGraphNodeDto[];
  edges: EntityGraphEdgeDto[];
  /** true, если результат был обрезан по лимиту nodes (100). */
  truncated: boolean;
}

// ─────────────────────── G.3 (KC-Temporal): mark-wrong ───────────────────

/**
 * Body для `POST /api/v1/knowledge/entities/:id/mark-wrong`.
 *
 * Помечает либо ребро (edgeId), либо саму сущность как «неверную». Минимум
 * одно поле edgeId/nodeId должно быть передано. taskType опц. — пропишется
 * в LlmPreferenceSample как override.
 */
export const MarkEntityWrongBodySchema = z
  .object({
    edgeId: z.string().trim().min(1).max(80).optional(),
    nodeId: z.string().trim().min(1).max(80).optional(),
    reason: z.string().trim().max(4_000).optional(),
    taskType: z.string().trim().min(1).max(80).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (!data.edgeId && !data.nodeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Нужен хотя бы edgeId или nodeId',
        path: ['edgeId'],
      });
    }
  });

export type MarkEntityWrongBody = z.infer<typeof MarkEntityWrongBodySchema>;

export interface MarkEntityWrongResultDto {
  ok: true;
  curationItemId: string;
  curationDecisionId: string;
}

export interface GraphNeighborsResultDto {
  rootNode: GraphNodeDto;
  nodes: GraphNodeDto[];
  edges: GraphEdgeDto[];
  /** true, если результат был обрезан по лимиту nodes (100). */
  truncated: boolean;
}

// ─────────────────────── Reasoning chain (KC-Temporal W3.2) ────────────────

/**
 * KC-Temporal W3.2 (2026-05-25) — query schema для
 * GET /blocks/:id/reasoning-chain?depth=1..3.
 */
export const ReasoningChainQuerySchema = z.object({
  depth: z.coerce.number().int().min(1).max(3).default(2),
});

export type ReasoningChainQuery = z.infer<typeof ReasoningChainQuerySchema>;

/** Узел reasoning-цепочки (BFS-обход IdeaBlockLink reasoning-типов). */
export interface ReasoningChainNodeDto {
  id: string;
  name: string;
  signalType: string;
  criticalQuestion: string;
  trustedAnswer: string;
  /** Глубина BFS от seed-блока (0 — сам seed). */
  depth: number;
}

/** Ребро reasoning-цепочки. */
export interface ReasoningChainEdgeDto {
  fromBlockId: string;
  toBlockId: string;
  relationType: string;
  confidence: number;
}

export interface ReasoningChainResultDto {
  /** Запрошенная глубина (effective, после клампа в [1,3]). */
  depth: number;
  nodes: ReasoningChainNodeDto[];
  edges: ReasoningChainEdgeDto[];
}
