import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  type CardSpecialistHandler,
  type CardSpecialistResult,
  CardSpecialistRegistry,
} from '../../chat-v2/services/card-specialist-registry.service';

/**
 * SBA β-4 — обработчик `CardSpecialistRegistry` для специалиста 3.5
 * (Insights Radar).
 *
 * Регистрируется в `CardSpecialistRegistry` через `onModuleInit`.
 * Возвращает Insight-карточки, чьи `sourceBlockIds` пересекаются с
 * `candidateBlockIds` retrieval'а chat-v2, плюс ILIKE-поиск по `statement` /
 * `mitigationPlan`.
 *
 * Контракт `CardSpecialistHandler`:
 *   - метод НЕ должен бросать — на любую ошибку возвращаем `[]` и логируем.
 *   - tenant isolation: запрос всегда фильтруется по `tenantId`.
 *   - `confidence` — берём из самой записи; иначе fallback на 0.7.
 *   - возвращаем только status ∈ ('active', 'mitigating', 'mitigated') —
 *     archived/false_alarm в chat-v2 не показываем.
 */
@Injectable()
export class Specialist35CardHandler
  implements OnModuleInit, CardSpecialistHandler
{
  private readonly logger = new Logger(Specialist35CardHandler.name);
  static readonly SPECIALIST_NAME = '3-5-insights';
  private static readonly DEFAULT_CONFIDENCE = 0.7;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CardSpecialistRegistry)
    private readonly registry: CardSpecialistRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(Specialist35CardHandler.SPECIALIST_NAME, this);
    this.logger.log(
      `Specialist35CardHandler зарегистрирован как '${Specialist35CardHandler.SPECIALIST_NAME}' в CardSpecialistRegistry`,
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
      const tenantId = args.tenantId;
      const blockIds = args.candidateBlockIds.slice(0, 200);
      const blockSet = new Set(blockIds);

      const queryWords = args.query
        .trim()
        .split(/\s+/)
        .filter((w) => w.length >= 3)
        .slice(0, 3)
        .join(' ');

      const orConditions: Prisma.InsightWhereInput[] = [];
      if (blockIds.length > 0) {
        orConditions.push({ sourceBlockIds: { hasSome: [...blockIds] } });
      }
      if (queryWords) {
        orConditions.push(
          { statement: { contains: queryWords, mode: 'insensitive' } },
          { mitigationPlan: { contains: queryWords, mode: 'insensitive' } },
        );
      }
      if (orConditions.length === 0) return [];

      const where: Prisma.InsightWhereInput = {
        tenantId,
        status: { in: ['active', 'mitigating', 'mitigated'] },
        OR: orConditions,
      };

      const insights = await this.prisma.insight.findMany({
        where,
        select: {
          id: true,
          statement: true,
          kind: true,
          severity: true,
          dynamicLabel: true,
          sourceBlockIds: true,
          confidence: true,
          mitigationPlan: true,
        },
        take: Math.max(args.limit * 3, 30),
      });

      interface Candidate {
        result: CardSpecialistResult;
        score: number;
      }
      const candidates: Candidate[] = [];
      const queryWordsLower = queryWords.toLowerCase();

      for (const ins of insights) {
        const overlap = ins.sourceBlockIds.filter((b) => blockSet.has(b)).length;
        const stmt = ins.statement ?? '';
        const mit = ins.mitigationPlan ?? '';
        const haystack = `${stmt} ${mit}`.toLowerCase();
        const ilikeHit =
          queryWordsLower && haystack.includes(queryWordsLower) ? 1 : 0;
        // Bonus для severity high/critical и dynamicLabel spike/growing.
        const sevBonus =
          ins.severity === 'critical' ? 2 : ins.severity === 'high' ? 1 : 0;
        const dynBonus =
          ins.dynamicLabel === 'spike'
            ? 2
            : ins.dynamicLabel === 'growing'
              ? 1
              : 0;
        const score = overlap * 2 + ilikeHit + sevBonus + dynBonus;
        if (score === 0) continue;
        const baseConfidence =
          ins.confidence !== null
            ? Number(ins.confidence)
            : Specialist35CardHandler.DEFAULT_CONFIDENCE;
        const finalConfidence = Math.min(
          1,
          baseConfidence + Math.min(0.1, overlap * 0.02),
        );
        const title = stmt.slice(0, 100);
        const text = mit && mit.length > 0 ? mit.slice(0, 600) : stmt.slice(0, 600);
        candidates.push({
          result: {
            id: ins.id,
            type: 'insight',
            title: title || '(без заголовка)',
            text,
            sourceBlockIds: ins.sourceBlockIds,
            confidence: finalConfidence,
          },
          score,
        });
      }

      candidates.sort((a, b) => b.score - a.score);
      return candidates.slice(0, args.limit).map((c) => c.result);
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'Specialist35CardHandler.getCardsForQuery упал — возвращаю []',
      );
      return [];
    }
  }
}
