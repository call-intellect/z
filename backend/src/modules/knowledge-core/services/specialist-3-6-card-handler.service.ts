import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  type CardSpecialistHandler,
  type CardSpecialistResult,
  CardSpecialistRegistry,
} from '../../chat-v2/services/card-specialist-registry.service';

@Injectable()
export class Specialist36CardHandler implements OnModuleInit, CardSpecialistHandler {
  private readonly logger = new Logger(Specialist36CardHandler.name);
  static readonly SPECIALIST_NAME = '3-6-ideas';
  private static readonly DEFAULT_CONFIDENCE = 0.6;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CardSpecialistRegistry)
    private readonly registry: CardSpecialistRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(Specialist36CardHandler.SPECIALIST_NAME, this);
    this.logger.log(
      `Specialist36CardHandler зарегистрирован как '${Specialist36CardHandler.SPECIALIST_NAME}'`,
    );
  }

  async getCardsForQuery(args: {
    tenantId: string;
    query: string;
    candidateBlockIds: readonly string[];
    limit: number;
  }): Promise<readonly CardSpecialistResult[]> {
    try {
      if (args.limit <= 0) return [];
      const blockIds = args.candidateBlockIds.slice(0, 200);
      const blockSet = new Set(blockIds);
      const queryWords = args.query
        .trim()
        .split(/\s+/)
        .filter((w) => w.length >= 3)
        .slice(0, 3)
        .join(' ');

      const orConditions: Prisma.IdeaWhereInput[] = [];
      if (blockIds.length > 0) {
        orConditions.push({ sourceBlockIds: { hasSome: [...blockIds] } });
      }
      if (queryWords) {
        orConditions.push(
          { statement: { contains: queryWords, mode: 'insensitive' } },
          { rationale: { contains: queryWords, mode: 'insensitive' } },
        );
      }
      if (orConditions.length === 0) return [];

      const ideas = await this.prisma.idea.findMany({
        where: {
          tenantId: args.tenantId,
          status: { notIn: ['rejected', 'archived'] },
          OR: orConditions,
        },
        select: {
          id: true,
          statement: true,
          rationale: true,
          kind: true,
          status: true,
          weight: true,
          sourceBlockIds: true,
          confidence: true,
        },
        take: Math.max(args.limit * 3, 30),
      });

      const candidates = ideas
        .map((i) => {
          const overlap = i.sourceBlockIds.filter((b) => blockSet.has(b)).length;
          const baseConfidence =
            i.confidence !== null
              ? Number(i.confidence)
              : Specialist36CardHandler.DEFAULT_CONFIDENCE;
          const finalConfidence = Math.min(
            1,
            baseConfidence +
              Math.min(0.1, overlap * 0.02) +
              Math.min(0.05, Number(i.weight) * 0.001),
          );
          const text =
            i.rationale && i.rationale.length > 0
              ? i.rationale.slice(0, 600)
              : i.statement.slice(0, 600);
          return {
            score: overlap * 2 + (queryWords ? 1 : 0),
            result: {
              id: i.id,
              type: 'idea',
              title: i.statement.slice(0, 100) || '(без заголовка)',
              text,
              sourceBlockIds: i.sourceBlockIds,
              confidence: finalConfidence,
            } satisfies CardSpecialistResult,
          };
        })
        .filter((c) => c.score > 0)
        .sort((a, b) => b.score - a.score);
      return candidates.slice(0, args.limit).map((c) => c.result);
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'Specialist36CardHandler.getCardsForQuery упал — возвращаю []',
      );
      return [];
    }
  }
}
