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
 * SBA α-6 — обработчик CardSpecialistRegistry для специалиста 3.4 (см. §5.6
 * контракта зонтичного).
 *
 * Регистрирует себя в `CardSpecialistRegistry` через `onModuleInit`. Запрашивается
 * `ChatV2Service` при выборе релевантных карточек для query: специалист отдаёт
 * Card'ы, у которых `sourceBlockIds` пересекаются с `candidateBlockIds`
 * retrieval'а chat-v2 (или у которых `entityId` принадлежит сущностям этих
 * блоков). Релевантность считается простым overlap-score; при необходимости
 * можно подключить embedding (на α-6 — простая эвристика, embedding-search
 * см. в roadmap β-2).
 *
 * Контракт `CardSpecialistHandler`:
 *   - метод НЕ должен бросать — на любую ошибку возвращаем `[]` и логируем.
 *   - tenant isolation: запрос всегда фильтруется по `tenantId`.
 *   - `confidence` — берём `Card.confidence` (последний rollup), fallback 0.7.
 */
@Injectable()
export class Specialist34CardHandler
  implements OnModuleInit, CardSpecialistHandler
{
  private readonly logger = new Logger(Specialist34CardHandler.name);
  /** Имя специалиста (должно совпадать с RouterService.SPECIALIST.PROJECT_CUSTOMER). */
  static readonly SPECIALIST_NAME = '3-4-project-customer';

  /** Дефолтный confidence, если у Card нет confidence (legacy без rollup'а). */
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

      // 1. Card'ы, у которых sourceBlockIds пересекаются с candidateBlockIds.
      //    Это самый прямой сигнал релевантности — те же блоки участвовали
      //    в rollup'е карточки.
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
        // Б41 [K3]: детерминированный отбор при take. Без orderBy Postgres
        // отдаёт произвольные строки — chat-v2 получал недетерминированный
        // набор карточек. Самые уверенные / свежеподтверждённые — первыми.
        orderBy: [
          { confidence: 'desc' },
          { lastConfirmedAt: 'desc' },
          { id: 'asc' },
        ],
        take: Math.max(args.limit * 3, 30),
      });

      // 2. Card'ы, у которых entityId совпадает с сущностями из block'ов
      //    (только если type ∈ customer/vendor/project/product/client).
      //    Это второй сигнал — карточка явно про сущность блока, но rollup
      //    мог ещё не выполниться.
      const blockEntityMentions = await this.prisma.ideaBlockEntity.findMany({
        where: {
          blockId: { in: [...blockIds] },
          // Б43 [K2]: tenant-инвариант — IdeaBlockEntity не имеет своего
          // tenantId, фильтруем через relation на block. Без этого
          // промежуточная выборка могла зацепить чужие блоки (если
          // candidateBlockIds пришли загрязнёнными).
          block: { tenantId },
          entity: {
            type: {
              in: ['customer', 'vendor', 'project', 'product', 'client'],
            },
          },
        },
        select: { entityId: true },
      });
      const entityIds = [
        ...new Set(blockEntityMentions.map((m) => m.entityId)),
      ];

      const candidatesByEntity = entityIds.length
        ? await this.prisma.card.findMany({
            where: {
              tenantId,
              deletedAt: null,
              OR: [
                { entityId: { in: entityIds } },
                { relatedEntityIds: { hasSome: entityIds } },
              ],
            },
            select: {
              id: true,
              name: true,
              summaryCache: true,
              sourceBlockIds: true,
              confidence: true,
              kind: true,
            },
            // Б41 [K3]: тот же детерминированный orderBy, что и для выборки
            // по sourceBlockIds — без него take отдавал произвольные строки.
            orderBy: [
              { confidence: 'desc' },
              { lastConfirmedAt: 'desc' },
              { id: 'asc' },
            ],
            take: Math.max(args.limit * 3, 30),
          })
        : [];

      // 3. Merge + scoring: больше overlap → выше score.
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
        const overlap = card.sourceBlockIds.filter((b) =>
          blockSet.has(b),
        ).length;
        const score = overlap + boost;
        const existing = byId.get(card.id);
        if (!existing || existing.score < score) {
          byId.set(card.id, { card, score });
        }
      }

      for (const c of candidatesBySource) addCandidate(c, 1);
      for (const c of candidatesByEntity) addCandidate(c, 0.5);

      const sorted = [...byId.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, args.limit);

      return sorted.map(({ card, score }) => {
        const baseConfidence =
          card.confidence !== null
            ? Number(card.confidence)
            : Specialist34CardHandler.DEFAULT_CONFIDENCE;
        // Слегка повышаем confidence пропорционально overlap'у (макс +0.1).
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
