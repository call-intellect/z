import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { EntityGraphService } from '../services/entity-graph.service';

/**
 * EntityGraphBuilderCron — раз в час сканирует Org'и и достраивает граф
 * связей между сущностями (`EntityLink`).
 *
 * Алгоритм на тик:
 *   1. Найти активные Org'и (с хотя бы одним owner/admin membership).
 *   2. Для каждой Org — `findCoMentionedPairs(orgId, minComentions, 50)`.
 *   3. Для каждой пары — подгрузить 5 последних совместных блоков (контекст
 *      для LLM) и вызвать `judgeRelation`.
 *   4. Если verdict valid и confidence >= LINK_MIN_CONFIDENCE → upsert
 *      EntityLink (createdBy='linker').
 *
 * NB: cron-expression в декораторе фиксирован (`'0 * * * *'`) — это совпадает
 * с дефолтом `ENTITY_GRAPH_BUILDER_CRON`. Если потребуется кастом из ENV —
 * переписать на SchedulerRegistry.
 *
 * Лимит на тик: 50 пар на Org. LLM-вызов на каждую пару — последовательно.
 */
@Injectable()
export class EntityGraphBuilderCron {
  private readonly logger = new Logger(EntityGraphBuilderCron.name);
  private static readonly PAIRS_PER_ORG_LIMIT = 50;
  private static readonly RECENT_BLOCKS_FOR_CONTEXT = 5;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(EntityGraphService) private readonly graph: EntityGraphService,
  ) {}

  @Cron('0 * * * *')
  async sweep(): Promise<void> {
    try {
      const summary = await this.scanAllOrgs();
      this.logger.log(
        summary,
        'entity-graph-builder: scanned X orgs, created/updated Y links',
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'entity-graph-builder: непойманная ошибка — повтор через 1 час',
      );
    }
  }

  /** Вынесен публично для возможного админ-эндпоинта / ручного запуска. */
  async scanAllOrgs(): Promise<{
    scannedOrgs: number;
    upsertedLinks: number;
  }> {
    const minComentions = this.cfg.knowledgeCore.entityGraphMinComentions;
    const minConfidence = this.cfg.knowledgeCore.linkMinConfidence;

    const orgs = await this.prisma.org.findMany({
      where: {
        deletedAt: null,
        memberships: {
          some: { role: { in: ['owner', 'admin'] } },
        },
      },
      select: { id: true },
    });
    let scannedOrgs = 0;
    let upsertedLinks = 0;

    for (const org of orgs) {
      scannedOrgs += 1;
      const pairs = await this.graph.findCoMentionedPairs({
        tenantId: org.id,
        minComentions,
        limit: EntityGraphBuilderCron.PAIRS_PER_ORG_LIMIT,
      });
      for (const pair of pairs) {
        try {
          const recentBlocks = await this.graph.findRecentSharedBlocks({
            entityAId: pair.entityA.id,
            entityBId: pair.entityB.id,
            limit: EntityGraphBuilderCron.RECENT_BLOCKS_FOR_CONTEXT,
          });
          const verdict = await this.graph.judgeRelation({
            tenantId: org.id,
            entityA: pair.entityA,
            entityB: pair.entityB,
            recentBlocks,
          });
          if (verdict.relationType === null) continue;
          if (verdict.confidence < minConfidence) continue;

          const confidenceDecimal = new Prisma.Decimal(
            verdict.confidence.toFixed(3),
          );
          // С Фазы 0a EntityLink — полиморфная модель (fromType/toType).
          // Для legacy Entity↔Entity связей явно ставим fromType='entity',
          // toType='entity' — иначе composite unique ключ не совпадёт
          // и upsert создаст дубликат при следующем проходе.
          await this.prisma.entityLink.upsert({
            where: {
              fromEntityId_fromType_toEntityId_toType_relationType: {
                fromEntityId: pair.entityA.id,
                fromType: 'entity',
                toEntityId: pair.entityB.id,
                toType: 'entity',
                relationType: verdict.relationType,
              },
            },
            update: {
              confidence: confidenceDecimal,
              explanation: verdict.explanation,
              status: 'active',
            },
            create: {
              tenantId: org.id,
              fromEntityId: pair.entityA.id,
              fromType: 'entity',
              toEntityId: pair.entityB.id,
              toType: 'entity',
              relationType: verdict.relationType,
              confidence: confidenceDecimal,
              explanation: verdict.explanation,
              createdBy: 'linker',
              status: 'active',
            },
          });
          upsertedLinks += 1;
        } catch (err) {
          this.logger.warn(
            {
              aId: pair.entityA.id,
              bId: pair.entityB.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'entity-graph-builder: ошибка на паре — продолжаю',
          );
        }
      }
    }
    return { scannedOrgs, upsertedLinks };
  }
}
