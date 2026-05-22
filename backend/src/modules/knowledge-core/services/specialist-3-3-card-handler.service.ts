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
 * SBA β-3 — обработчик `CardSpecialistRegistry` для специалиста 3.3
 * (Decisions).
 *
 * Регистрируется в `CardSpecialistRegistry` через `onModuleInit`.
 * Возвращает Decision-карточки, чьи `sourceBlockIds` пересекаются с
 * `candidateBlockIds` retrieval'а chat-v2, плюс ILIKE-поиск по
 * `statement` / `rationale` / `actualOutcomes`.
 *
 * Контракт `CardSpecialistHandler`:
 *   - метод НЕ должен бросать — на любую ошибку возвращаем `[]` и логируем.
 *   - tenant isolation: запрос всегда фильтруется по `tenantId`.
 *   - `confidence` — берём из самой записи (Decimal), иначе 0.75 (decisions
 *     обычно высокого качества — deep review).
 *   - возвращаем только status NOT IN ('rejected','cancelled','superseded') —
 *     устаревшие версии не показываем в chat-v2.
 */
@Injectable()
export class Specialist33CardHandler
  implements OnModuleInit, CardSpecialistHandler
{
  private readonly logger = new Logger(Specialist33CardHandler.name);
  static readonly SPECIALIST_NAME = '3-3-decisions';
  private static readonly DEFAULT_CONFIDENCE = 0.75;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CardSpecialistRegistry)
    private readonly registry: CardSpecialistRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(Specialist33CardHandler.SPECIALIST_NAME, this);
    this.logger.log(
      `Specialist33CardHandler зарегистрирован как '${Specialist33CardHandler.SPECIALIST_NAME}' в CardSpecialistRegistry`,
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

      const where: Prisma.DecisionWhereInput = {
        tenantId,
        status: {
          notIn: ['rejected', 'cancelled', 'superseded'],
        },
      };
      // OR — overlap по sourceBlockIds ИЛИ ILIKE по statement/rationale/actualOutcomes.
      const queryWords = args.query
        .trim()
        .split(/\s+/)
        .filter((w) => w.length >= 3)
        .slice(0, 3)
        .join(' ');
      const orConditions: Prisma.DecisionWhereInput[] = [];
      if (blockIds.length > 0) {
        orConditions.push({ sourceBlockIds: { hasSome: [...blockIds] } });
      }
      if (queryWords) {
        orConditions.push(
          { statement: { contains: queryWords, mode: 'insensitive' } },
          { rationale: { contains: queryWords, mode: 'insensitive' } },
          { actualOutcomes: { contains: queryWords, mode: 'insensitive' } },
        );
      }
      if (orConditions.length === 0) return [];
      where.OR = orConditions;

      const decisions = await this.prisma.decision.findMany({
        where,
        select: {
          id: true,
          statement: true,
          text: true,
          rationale: true,
          sourceBlockIds: true,
          confidence: true,
          actualOutcomes: true,
        },
        take: Math.max(args.limit * 3, 30),
      });

      interface Candidate {
        result: CardSpecialistResult;
        score: number;
      }
      const candidates: Candidate[] = [];
      const queryWordsLower = queryWords.toLowerCase();

      for (const d of decisions) {
        const overlap = d.sourceBlockIds.filter((b) => blockSet.has(b)).length;
        const statement = d.statement ?? d.text ?? '';
        const rationale = d.rationale ?? '';
        const outcomes = d.actualOutcomes ?? '';
        const haystack = `${statement} ${rationale} ${outcomes}`.toLowerCase();
        const ilikeHit = queryWordsLower && haystack.includes(queryWordsLower) ? 1 : 0;
        const score = overlap * 2 + ilikeHit;
        if (score === 0) continue;
        const baseConfidence =
          d.confidence !== null
            ? Number(d.confidence)
            : Specialist33CardHandler.DEFAULT_CONFIDENCE;
        const finalConfidence = Math.min(
          1,
          baseConfidence + Math.min(0.1, overlap * 0.02),
        );
        const title = statement.slice(0, 100);
        const text =
          rationale && rationale.length > 0
            ? rationale.slice(0, 600)
            : statement.slice(0, 600);
        candidates.push({
          result: {
            id: d.id,
            type: 'decision',
            title: title || '(без заголовка)',
            text,
            sourceBlockIds: d.sourceBlockIds,
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
        'Specialist33CardHandler.getCardsForQuery упал — возвращаю []',
      );
      return [];
    }
  }
}
