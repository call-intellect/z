import { Inject, Injectable, Logger } from '@nestjs/common';
import type { IdeaBlockLinkType } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

const REASONING_LINK_TYPES: ReadonlyArray<IdeaBlockLinkType> = [
  'consequences_of',
  'causes',
  'develops',
  'question_answered_by',
];

const MAX_NODES = 50;

export interface BlockSummary {
  id: string;
  name: string;
  signalType: string;
  criticalQuestion: string;
  trustedAnswer: string;
  depth: number;
}

export interface LinkSummary {
  fromBlockId: string;
  toBlockId: string;
  relationType: IdeaBlockLinkType;
  confidence: number;
}

export interface ReasoningChain {
  nodes: BlockSummary[];
  edges: LinkSummary[];
}

@Injectable()
export class ReasoningChainService {
  private readonly logger = new Logger(ReasoningChainService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async buildChain(
    blockId: string,
    maxDepth = 3,
    accessWhere?: Record<string, unknown>,
  ): Promise<ReasoningChain> {
    const depthLimit = Math.max(0, Math.min(3, maxDepth));

    const seed = await this.prisma.ideaBlock.findUnique({
      where: { id: blockId },
      select: {
        id: true,
        name: true,
        signalType: true,
        criticalQuestion: true,
        trustedAnswer: true,
        tenantId: true,
        status: true,
      },
    });
    if (!seed || seed.status !== 'canonical') {
      return { nodes: [], edges: [] };
    }

    const tenantId = seed.tenantId;
    const nodes = new Map<string, BlockSummary>();
    const edges: LinkSummary[] = [];
    const edgeKeys = new Set<string>();

    nodes.set(seed.id, {
      id: seed.id,
      name: seed.name,
      signalType: seed.signalType,
      criticalQuestion: seed.criticalQuestion,
      trustedAnswer: seed.trustedAnswer,
      depth: 0,
    });

    let frontier: string[] = [seed.id];

    for (let depth = 1; depth <= depthLimit; depth++) {
      if (frontier.length === 0) break;
      if (nodes.size >= MAX_NODES) break;

      const links = await this.prisma.ideaBlockLink.findMany({
        where: {
          tenantId,
          status: 'active',
          relationType: { in: [...REASONING_LINK_TYPES] },
          OR: [{ fromBlockId: { in: frontier } }, { toBlockId: { in: frontier } }],
        },
        select: {
          fromBlockId: true,
          toBlockId: true,
          relationType: true,
          confidence: true,
        },
      });
      if (links.length === 0) break;

      const newNeighbours = new Set<string>();
      const edgesByNeighbour = new Map<string, LinkSummary[]>();
      for (const l of links) {
        const key = `${l.fromBlockId}|${l.toBlockId}|${l.relationType}`;
        if (edgeKeys.has(key)) continue;
        const summary: LinkSummary = {
          fromBlockId: l.fromBlockId,
          toBlockId: l.toBlockId,
          relationType: l.relationType,
          confidence: numberFromDecimal(l.confidence),
        };
        const otherId = nodes.has(l.fromBlockId) ? l.toBlockId : l.fromBlockId;
        if (nodes.has(otherId)) {
          edgeKeys.add(key);
          edges.push(summary);
          continue;
        }
        newNeighbours.add(otherId);
        const arr = edgesByNeighbour.get(otherId) ?? [];
        arr.push(summary);
        edgesByNeighbour.set(otherId, arr);
        edgeKeys.add(key);
      }
      if (newNeighbours.size === 0) break;

      const neighbourBlocks = await this.prisma.ideaBlock.findMany({
        where: {
          id: { in: [...newNeighbours] },
          tenantId,
          status: 'canonical',
          ...(accessWhere ?? {}),
        },
        select: {
          id: true,
          name: true,
          signalType: true,
          criticalQuestion: true,
          trustedAnswer: true,
        },
      });

      const nextFrontier: string[] = [];
      for (const nb of neighbourBlocks) {
        if (nodes.size >= MAX_NODES) break;
        nodes.set(nb.id, {
          id: nb.id,
          name: nb.name,
          signalType: nb.signalType,
          criticalQuestion: nb.criticalQuestion,
          trustedAnswer: nb.trustedAnswer,
          depth,
        });
        const nbEdges = edgesByNeighbour.get(nb.id);
        if (nbEdges) edges.push(...nbEdges);
        nextFrontier.push(nb.id);
      }
      frontier = nextFrontier;
    }

    return { nodes: [...nodes.values()], edges };
  }
}

function numberFromDecimal(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (v && typeof (v as { toString?: () => string }).toString === 'function') {
    const n = Number((v as { toString: () => string }).toString());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
