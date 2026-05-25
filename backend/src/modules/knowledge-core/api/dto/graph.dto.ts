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
