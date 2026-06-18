import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { WorkerOrgGate } from '../../core-queue/worker-org-gate';
import { EntityGraphService } from '../services/entity-graph.service';
import { EntityLinkService } from '../services/entity-link.service';

@Injectable()
export class EntityGraphBuilderCron {
  private readonly logger = new Logger(EntityGraphBuilderCron.name);
  private static readonly PAIRS_PER_ORG_LIMIT = 50;
  private static readonly RECENT_BLOCKS_FOR_CONTEXT = 5;
  // Б17 [K2]: имя воркера для Org-Admin тумблера (Org.workersEnabled).
  // Совпадает с taskType / именем файла (канон реестра gate).
  private static readonly WORKER_NAME = 'entity-graph-builder';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(EntityGraphService) private readonly graph: EntityGraphService,
    @Inject(EntityLinkService)
    private readonly entityLinks: EntityLinkService,
    // Б17 [K2]: Org-Admin тумблер воркера — без него граф строится и жжёт
    // LLM при выключенном воркере.
    @Inject(WorkerOrgGate) private readonly gate: WorkerOrgGate,
  ) {}

  @Cron('0 * * * *')
  async sweep(): Promise<void> {
    try {
      const summary = await this.scanAllOrgs();
      this.logger.debug(summary, 'entity-graph-builder: scanned X orgs, created/updated Y links');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'entity-graph-builder: непойманная ошибка — повтор через 1 час',
      );
    }
  }

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
      // Б17 [K2]: Org-Admin тумблер — если воркер выключен для Org, пропускаем
      // (не валим весь тик, не жжём LLM на findCoMentionedPairs/judgeRelation).
      try {
        await this.gate.checkOrThrow(org.id, EntityGraphBuilderCron.WORKER_NAME);
      } catch {
        this.logger.debug(
          { tenantId: org.id },
          'entity-graph-builder: gate disabled — skip Org',
        );
        continue;
      }
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

          await this.entityLinks.upsertRichEdge({
            tenantId: org.id,
            fromEntityId: pair.entityA.id,
            fromType: 'entity',
            toEntityId: pair.entityB.id,
            toType: 'entity',
            relationType: verdict.relationType,
            confidence: verdict.confidence,
            explanation: verdict.explanation,
            createdBy: 'linker',
            attributes: verdict.attributes ?? null,
            sourceBlockIds: recentBlocks.map((b) => b.id),
            validFrom: parseHintToDate(verdict.validFromHint),
            validUntil: parseHintToDate(verdict.validUntilHint),
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

function parseHintToDate(hint: string | null | undefined): Date | undefined {
  if (!hint || typeof hint !== 'string') return undefined;
  const trimmed = hint.trim();
  if (trimmed.length === 0) return undefined;
  let normalized = trimmed;
  if (/^\d{4}$/.test(trimmed)) {
    normalized = `${trimmed}-01-01`;
  } else if (/^\d{4}-\d{2}$/.test(trimmed)) {
    normalized = `${trimmed}-01`;
  } else if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return undefined;
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}
