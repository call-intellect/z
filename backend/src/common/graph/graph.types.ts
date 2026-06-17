import type { EntityLinkType, LinkCreatedBy } from '@prisma/client';

export type NodeType =
  | 'role'
  | 'department'
  | 'person'
  | 'job-description'
  | 'skill'
  | 'document'
  | 'role-profile'
  | 'mission'
  | 'vision'
  | 'strategy'
  | 'process'
  | 'process-step'
  | 'regulation'
  | 'policy'
  | 'tool'
  | 'metric'
  | 'decision'
  | 'entity'
  | 'goal'
  | 'meeting'
  | 'idea-block'
  | 'theme';

export const ALL_NODE_TYPES: readonly NodeType[] = [
  'role',
  'department',
  'person',
  'job-description',
  'skill',
  'document',
  'role-profile',
  'mission',
  'vision',
  'strategy',
  'process',
  'process-step',
  'regulation',
  'policy',
  'tool',
  'metric',
  'decision',
  'entity',
  'goal',
  'meeting',
  'idea-block',
  'theme',
] as const;

export interface NodeRef {
  type: NodeType;
  id: string;
}

export interface AddNodeParams {
  tenantId: string;
  type: NodeType;
  id: string;
  properties?: Record<string, unknown>;
}

export interface RemoveNodeParams {
  tenantId: string;
  type: NodeType;
  id: string;
}

export interface AddEdgeParams {
  tenantId: string;
  from: NodeRef;
  to: NodeRef;
  linkType: EntityLinkType;
  validFrom?: Date;
  validTo?: Date | null;
  properties?: Record<string, unknown>;
  confidence?: number;
  explanation?: string;
  createdBy?: LinkCreatedBy;
}

export interface RemoveEdgeParams {
  tenantId: string;
  from: NodeRef;
  to: NodeRef;
  linkType: EntityLinkType;
  deletedBy?: string;
}

export interface GetNeighborsParams {
  tenantId: string;
  node: NodeRef;
  linkTypes?: EntityLinkType[];
  direction?: 'in' | 'out' | 'both';
  depth?: number;
  limit?: number;
}

export interface GraphNode {
  type: NodeType;
  id: string;
  properties?: Record<string, unknown>;
}

export interface GraphEdge {
  fromId: string;
  fromType: NodeType;
  toId: string;
  toType: NodeType;
  linkType: EntityLinkType;
  confidence?: number;
  validFrom?: Date;
  validTo?: Date | null;
  properties?: Record<string, unknown>;
}

export interface NeighborResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface FindPathParams {
  tenantId: string;
  from: NodeRef;
  to: NodeRef;
  maxDepth?: number;
  linkTypes?: EntityLinkType[];
}

export interface PathResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  length: number;
}

export interface TraverseParams {
  tenantId: string;
  start: NodeRef;
  cypher: string;
  bindings?: Record<string, unknown>;
}

export interface UpsertEntityParams {
  tenantId: string;
  type: NodeType;
  data: Record<string, unknown>;
  sourceProvenance?: {
    rawEventId?: string;
    ideaBlockId?: string;
    documentId?: string;
  };
  confidence?: number;
}

export interface UpsertEntityResult {
  id: string;
  created: boolean;
}
