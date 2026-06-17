import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  type CardSpecialistHandler,
  type CardSpecialistResult,
  CardSpecialistRegistry,
} from '../../chat-v2/services/card-specialist-registry.service';

@Injectable()
export class Specialist34CardHandler implements OnModuleInit, CardSpecialistHandler {
  private readonly logger = new Logger(Specialist34CardHandler.name);
  static readonly SPECIALIST_NAME = '3-4-project-customer';

  private static readonly DEFAULT_CONFIDENCE = 0.7;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CardSpecialistRegistry)
    private readonly registry: CardSpecialistRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(Specialist34CardHandler.SPECIALIST_NAME, this);
    this.logger.log(
      `Specialist34CardHandler зарегистрирован как '${Specialist34CardHandler.SPECIALIST_NAME}' в CardSpecialistRegistry`,
    );
  }

  async getCardsForQuery(args: {
    tenantId: string;
    query: string;
    candidateBlockIds: readonly string[];
    limit: number;
  }): Promise<readonly CardSpecialistResult[]> {
    try {
      if (args.candidateBlockIds.length === 0 || args.limit <= 0) {
        return [];
      }
      const tenantId = args.tenantId;
      const blockIds = args.candidateBlockIds.slice(0, 200);

      const candidatesBySource = await this.prisma.card.findMany({
        where: {
          tenantId,
          deletedAt: null,
          sourceBlockIds: { hasSome: [...blockIds] },
        },
        select: {
          id: true,
          name: true,
          summaryCache: true,
          sourceBlockIds: true,
          confidence: true,
          kind: true,
        },
        take: Math.max(args.limit * 3, 30),
      });

      const blockEntityMentions = await this.prisma.ideaBlockEntity.findMany({
        where: {
          blockId: { in: [...blockIds] },
          entity: {
            type: {
              in: ['customer', 'vendor', 'project', 'product', 'client'],
            },
          },
        },
        select: { entityId: true },
      });
      const entityIds = [...new Set(blockEntityMentions.map((m) => m.entityId))];

      const candidatesByEntity = entityIds.length
        ? await this.prisma.card.findMany({
            where: {
              tenantId,
              deletedAt: null,
              OR: [{ entityId: { in: entityIds } }, { relatedEntityIds: { hasSome: entityIds } }],
            },
            select: {
              id: true,
              name: true,
              summaryCache: true,
              sourceBlockIds: true,
              confidence: true,
              kind: true,
            },
            take: Math.max(args.limit * 3, 30),
          })
        : [];

      const byId = new Map<
        string,
        {
          card: {
            id: string;
            name: string;
            summaryCache: string | null;
            sourceBlockIds: string[];
            confidence: { toNumber: () => number } | null;
            kind: string;
          };
          score: number;
        }
      >();
      const blockSet = new Set(blockIds);

      function addCandidate(
        card: {
          id: string;
          name: string;
          summaryCache: string | null;
          sourceBlockIds: string[];
          confidence: { toNumber: () => number } | null;
          kind: string;
        },
        boost: number,
      ): void {
        const overlap = card.sourceBlockIds.filter((b) => blockSet.has(b)).length;
        const score = overlap + boost;
        const existing = byId.get(card.id);
        if (!existing || existing.score < score) {
          byId.set(card.id, { card, score });
        }
      }

      for (const c of candidatesBySource) addCandidate(c, 1);
      for (const c of candidatesByEntity) addCandidate(c, 0.5);

      const sorted = [...byId.values()].sort((a, b) => b.score - a.score).slice(0, args.limit);

      return sorted.map(({ card, score }) => {
        const baseConfidence =
          card.confidence !== null
            ? Number(card.confidence)
            : Specialist34CardHandler.DEFAULT_CONFIDENCE;
        const overlapBoost = Math.min(0.1, score * 0.02);
        const finalConfidence = Math.min(1, baseConfidence + overlapBoost);
        const result: CardSpecialistResult = {
          id: card.id,
          type: 'card',
          title: card.name,
          text: card.summaryCache ?? '',
          sourceBlockIds: card.sourceBlockIds,
          confidence: finalConfidence,
        };
        return result;
      });
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'Specialist34CardHandler.getCardsForQuery упал — возвращаю []',
      );
      return [];
    }
  }
}
