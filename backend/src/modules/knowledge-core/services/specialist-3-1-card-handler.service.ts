import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  type CardSpecialistHandler,
  type CardSpecialistResult,
  CardSpecialistRegistry,
} from '../../chat-v2/services/card-specialist-registry.service';

/**
 * SBA α-7 — обработчик `CardSpecialistRegistry` для специалиста 3.1
 * (Regulations / Processes / Policies).
 *
 * Регистрируется в `CardSpecialistRegistry` через `onModuleInit`. Возвращает
 * карточки Regulation/Process/Policy, у которых `sourceBlockIds`
 * пересекаются с `candidateBlockIds` retrieval'а chat-v2.
 *
 * Контракт `CardSpecialistHandler`:
 *   - метод НЕ должен бросать — на любую ошибку возвращаем `[]` и логируем.
 *   - tenant isolation: запрос всегда фильтруется по `tenantId`.
 *   - `confidence` — берём из самой записи (если есть) или дефолт 0.7.
 *
 * Type-маркер результата:
 *   - 'regulation' для Regulation.category='regulation'/'standard'.
 *   - 'process' для Process.
 *   - 'policy' для Policy.
 */
@Injectable()
export class Specialist31CardHandler
  implements OnModuleInit, CardSpecialistHandler
{
  private readonly logger = new Logger(Specialist31CardHandler.name);
  static readonly SPECIALIST_NAME = '3-1-regulations';
  private static readonly DEFAULT_CONFIDENCE = 0.7;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CardSpecialistRegistry)
    private readonly registry: CardSpecialistRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(Specialist31CardHandler.SPECIALIST_NAME, this);
    this.logger.log(
      `Specialist31CardHandler зарегистрирован как '${Specialist31CardHandler.SPECIALIST_NAME}' в CardSpecialistRegistry`,
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
      const blockSet = new Set(blockIds);

      // Regulation
      const regulations = await this.prisma.regulation.findMany({
        where: {
          tenantId,
          sourceBlockIds: { hasSome: [...blockIds] },
          status: 'active',
        },
        select: {
          id: true,
          name: true,
          statement: true,
          contentMd: true,
          sourceBlockIds: true,
          confidence: true,
          category: true,
        },
        take: Math.max(args.limit * 3, 30),
      });

      // Process
      const processes = await this.prisma.process.findMany({
        where: {
          tenantId,
          sourceBlockIds: { hasSome: [...blockIds] },
          status: 'active',
        },
        select: {
          id: true,
          name: true,
          description: true,
          sourceBlockIds: true,
          confidence: true,
        },
        take: Math.max(args.limit * 3, 30),
      });

      // Policy
      const policies = await this.prisma.policy.findMany({
        where: {
          tenantId,
          sourceBlockIds: { hasSome: [...blockIds] },
          status: 'active',
        },
        select: {
          id: true,
          name: true,
          contentMd: true,
          sourceBlockIds: true,
          confidence: true,
        },
        take: Math.max(args.limit * 3, 30),
      });

      interface Candidate {
        result: CardSpecialistResult;
        score: number;
      }
      const candidates: Candidate[] = [];

      for (const r of regulations) {
        const overlap = r.sourceBlockIds.filter((b) => blockSet.has(b)).length;
        const baseConfidence =
          r.confidence !== null
            ? r.confidence
            : Specialist31CardHandler.DEFAULT_CONFIDENCE;
        const finalConfidence = Math.min(1, baseConfidence + Math.min(0.1, overlap * 0.02));
        candidates.push({
          result: {
            id: r.id,
            type: 'regulation',
            title: r.name,
            text: r.statement ?? r.contentMd ?? '',
            sourceBlockIds: r.sourceBlockIds,
            confidence: finalConfidence,
          },
          score: overlap + 1,
        });
      }
      for (const p of processes) {
        const overlap = p.sourceBlockIds.filter((b) => blockSet.has(b)).length;
        const baseConfidence =
          p.confidence !== null
            ? p.confidence
            : Specialist31CardHandler.DEFAULT_CONFIDENCE;
        const finalConfidence = Math.min(1, baseConfidence + Math.min(0.1, overlap * 0.02));
        candidates.push({
          result: {
            id: p.id,
            type: 'process',
            title: p.name,
            text: p.description ?? '',
            sourceBlockIds: p.sourceBlockIds,
            confidence: finalConfidence,
          },
          score: overlap + 1,
        });
      }
      for (const po of policies) {
        const overlap = po.sourceBlockIds.filter((b) => blockSet.has(b)).length;
        const baseConfidence =
          po.confidence !== null
            ? po.confidence
            : Specialist31CardHandler.DEFAULT_CONFIDENCE;
        const finalConfidence = Math.min(1, baseConfidence + Math.min(0.1, overlap * 0.02));
        candidates.push({
          result: {
            id: po.id,
            type: 'policy',
            title: po.name,
            text: po.contentMd ?? '',
            sourceBlockIds: po.sourceBlockIds,
            confidence: finalConfidence,
          },
          score: overlap + 1,
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
        'Specialist31CardHandler.getCardsForQuery упал — возвращаю []',
      );
      return [];
    }
  }
}
