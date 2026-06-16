import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  type CardSpecialistHandler,
  type CardSpecialistResult,
  CardSpecialistRegistry,
} from '../services/card-specialist-registry.service';

@Injectable()
export class SprintCardHandler implements OnModuleInit, CardSpecialistHandler {
  private readonly logger = new Logger(SprintCardHandler.name);
  static readonly SPECIALIST_NAME = '3-13-sprint';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CardSpecialistRegistry)
    private readonly registry: CardSpecialistRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(SprintCardHandler.SPECIALIST_NAME, this);
    this.logger.log(`SprintCardHandler зарегистрирован как '${SprintCardHandler.SPECIALIST_NAME}'`);
  }

  async getCardsForQuery(args: {
    tenantId: string;
    query: string;
    candidateBlockIds: readonly string[];
    limit: number;
  }): Promise<readonly CardSpecialistResult[]> {
    try {
      if (args.limit <= 0) return [];

      const activeCycles = await this.prisma.cycle.findMany({
        where: { tenantId: args.tenantId, completedAt: null },
        orderBy: [{ startDate: 'desc' }],
        take: 50,
        select: {
          id: true,
          name: true,
          projectId: true,
          startDate: true,
          endDate: true,
          project: {
            select: {
              name: true,
              customerCard: { select: { name: true } },
              vendor: { select: { name: true } },
              subjectPerson: { select: { name: true } },
              department: { select: { name: true } },
            },
          },
        },
      });
      if (activeCycles.length === 0) return [];

      const cycleIds = activeCycles.map((c) => c.id);
      const blockIds = args.candidateBlockIds.slice(0, 200);
      const blockSet = new Set<string>(blockIds);
      const overlapByCycle = new Map<string, number>();
      if (blockIds.length > 0) {
        const issuesWithBlocks = await this.prisma.issue.findMany({
          where: {
            cycleId: { in: cycleIds },
            tenantId: args.tenantId,
            deletedAt: null,
            sourceBlockIds: { hasSome: blockIds },
          },
          select: { cycleId: true, sourceBlockIds: true },
        });
        for (const i of issuesWithBlocks) {
          if (!i.cycleId) continue;
          let cnt = 0;
          for (const b of i.sourceBlockIds) {
            if (blockSet.has(b)) cnt++;
          }
          overlapByCycle.set(i.cycleId, (overlapByCycle.get(i.cycleId) ?? 0) + cnt);
        }
      }

      const hintCounts = await this.prisma.sprintHint.groupBy({
        by: ['cycleId'],
        where: {
          cycleId: { in: cycleIds },
          tenantId: args.tenantId,
          status: 'active',
        },
        _count: { _all: true },
      });
      const hintCountByCycle = new Map<string, number>();
      for (const r of hintCounts) {
        hintCountByCycle.set(r.cycleId, r._count._all);
      }

      const queryLc = args.query.trim().toLowerCase();
      const candidates = activeCycles
        .map((c) => {
          const overlap = overlapByCycle.get(c.id) ?? 0;
          const hints = hintCountByCycle.get(c.id) ?? 0;
          const titleHit =
            queryLc.length >= 3 &&
            (c.name.toLowerCase().includes(queryLc) ||
              c.project.name.toLowerCase().includes(queryLc))
              ? 1
              : 0;
          const score = overlap * 2 + Math.min(5, hints) * 0.5 + titleHit;
          const scopeName =
            c.project.customerCard?.name ??
            c.project.vendor?.name ??
            c.project.subjectPerson?.name ??
            c.project.department?.name ??
            null;
          const summary = [
            `Активный спринт «${c.name}» в проекте «${c.project.name}»`,
            scopeName ? `Привязка: ${scopeName}` : null,
            `Подсказок помощника: ${hints}`,
            `${c.startDate.toISOString().slice(0, 10)} → ${c.endDate.toISOString().slice(0, 10)}`,
          ]
            .filter(Boolean)
            .join('. ');
          return {
            score,
            result: {
              id: c.id,
              type: 'sprint',
              title: c.name,
              text: summary,
              sourceBlockIds: [],
              confidence: Math.min(1, 0.4 + overlap * 0.05 + hints * 0.05),
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
        'SprintCardHandler.getCardsForQuery упал — возвращаю []',
      );
      return [];
    }
  }
}
