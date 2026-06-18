import { z } from 'zod';

export interface BlockLinkSideDto {
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
  type: string;
  label: string;
  confidence?: number;
}

export const EntityGraphQuerySchema = z.object({
  depth: z.coerce.number().int().min(1).max(3).default(2),
});

export type EntityGraphQuery = z.infer<typeof EntityGraphQuerySchema>;

export interface EntityGraphNodeDto {
  id: string;
  type: 'entity';
  entityType: string;
  name: string;
  depth: number;
}

export interface EntityGraphEvidenceDto {
  blockId: string;
  blockName: string;
  quote: string;
  sourceTimestamp: string | null;
}

export interface EntityGraphEdgeDto {
  edgeId: string;
  from: string;
  to: string;
  relationType: string;
  confidence: number;
  attributes: Record<string, unknown> | null;
  validFrom: string;
  validUntil: string | null;
  evidence: EntityGraphEvidenceDto[];
}

export interface EntityGraphResultDto {
  center: { id: string; type: 'entity'; entityType: string; name: string };
  nodes: EntityGraphNodeDto[];
  edges: EntityGraphEdgeDto[];
  truncated: boolean;
}

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
  truncated: boolean;
}

export const ReasoningChainQuerySchema = z.object({
  depth: z.coerce.number().int().min(1).max(3).default(2),
});

export interface ReasoningChainNodeDto {
  id: string;
  name: string;
  signalType: string;
  criticalQuestion: string;
  trustedAnswer: string;
  depth: number;
}

export interface ReasoningChainEdgeDto {
  fromBlockId: string;
  toBlockId: string;
  relationType: string;
  confidence: number;
}

export interface ReasoningChainResultDto {
  depth: number;
  nodes: ReasoningChainNodeDto[];
  edges: ReasoningChainEdgeDto[];
}
