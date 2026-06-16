import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { resolveAxisTenantTop } from '../services/tenant-top';

@Injectable()
export class ExperimentTransitionsCron {
  private readonly logger = new Logger(ExperimentTransitionsCron.name);
  private static readonly BATCH_LIMIT = 300;
  private static readonly LINKS_PER_EXPERIMENT = 20;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 7 * * *')
  async sweep(): Promise<void> {
    try {
      const orgs = await this.prisma.org.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });
      let totalResultLinks = 0;
      let totalLessonLinks = 0;
      for (const org of orgs) {
        try {
          const r = await this.processOrg(org.id);
          totalResultLinks += r.resultLinks;
          totalLessonLinks += r.lessonLinks;
        } catch (err) {
          this.logger.warn(
            {
              tenantId: org.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'experiment-transitions: ошибка обработки Org — пропускаю',
          );
        }
      }
      this.logger.debug(
        { orgs: orgs.length, totalResultLinks, totalLessonLinks },
        'experiment-transitions: проход завершён',
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'experiment-transitions: непойманная ошибка',
      );
    }
  }

  private async processOrg(
    tenantId: string,
  ): Promise<{ resultLinks: number; lessonLinks: number }> {
    const tenantTop = resolveAxisTenantTop(tenantId);
    const cutoff = new Date(Date.now() - 90 * 24 * 3600 * 1000);
    const experiments = await this.prisma.experiment.findMany({
      where: {
        tenantId,
        status: 'completed',
        OR: [{ lastConfirmedAt: { gte: cutoff } }, { completedAt: { gte: cutoff } }],
      },
      take: ExperimentTransitionsCron.BATCH_LIMIT,
    });

    let resultLinks = 0;
    let lessonLinks = 0;

    for (const exp of experiments) {
      try {
        if (!exp.entityId) continue;

        const blockIds = exp.sourceBlockIds;
        if (blockIds.length === 0) continue;

        const insights = await this.prisma.insight.findMany({
          where: {
            tenantId,
            status: { in: ['active', 'mitigating', 'mitigated'] },
            sourceBlockIds: { hasSome: blockIds },
            entityId: { not: null },
          },
          select: { id: true, entityId: true },
          take: ExperimentTransitionsCron.LINKS_PER_EXPERIMENT,
        });
        for (const ins of insights) {
          if (!ins.entityId) continue;
          try {
            await this.upsertLink({
              tenantId,
              fromEntityId: exp.entityId,
              fromType: 'experiment',
              toEntityId: ins.entityId,
              toType: 'insight',
              relationType: 'result_supports_insight',
              explanation: `Эксперимент «${exp.name.slice(0, 60)}» подтверждает сигнал (общие блоки-источники).`,
              properties: {
                experimentId: exp.id,
                insightId: ins.id,
                source: 'experiment-transitions-cron',
              },
            });
            resultLinks += 1;
          } catch (err) {
            this.logger.debug(
              {
                experimentId: exp.id,
                insightId: ins.id,
                err: err instanceof Error ? err.message : String(err),
              },
              'experiment-transitions: upsert result_supports_insight упал — пропускаю',
            );
          }
        }

        const lessons = Array.isArray(exp.lessonsJson)
          ? (exp.lessonsJson as Array<{ sourceBlockId?: string }>)
          : [];
        const lessonBlockIds = lessons
          .map((l) => l?.sourceBlockId)
          .filter((b): b is string => typeof b === 'string' && b.length > 0);
        const decisionScopeBlocks = lessonBlockIds.length > 0 ? lessonBlockIds : blockIds;
        const decisions = await this.prisma.decision.findMany({
          where: {
            tenantId,
            status: { notIn: ['rejected', 'cancelled', 'superseded'] },
            sourceBlockIds: { hasSome: decisionScopeBlocks },
            entityId: { not: null },
          },
          select: { id: true, entityId: true },
          take: ExperimentTransitionsCron.LINKS_PER_EXPERIMENT,
        });
        for (const dec of decisions) {
          if (!dec.entityId) continue;
          try {
            await this.upsertLink({
              tenantId,
              fromEntityId: exp.entityId,
              fromType: 'experiment',
              toEntityId: dec.entityId,
              toType: 'decision',
              relationType: 'lesson_informs_decision',
              explanation: `Урок эксперимента «${exp.name.slice(0, 60)}» имеет общие источники с решением.`,
              properties: {
                experimentId: exp.id,
                decisionId: dec.id,
                source: 'experiment-transitions-cron',
              },
            });
            lessonLinks += 1;
          } catch (err) {
            this.logger.debug(
              {
                experimentId: exp.id,
                decisionId: dec.id,
                err: err instanceof Error ? err.message : String(err),
              },
              'experiment-transitions: upsert lesson_informs_decision упал — пропускаю',
            );
          }
        }
      } catch (err) {
        this.logger.warn(
          {
            experimentId: exp.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'experiment-transitions: ошибка эксперимента — пропускаю',
        );
      }
    }

    if (resultLinks > 0 || lessonLinks > 0) {
      this.logger.debug(
        { tenantTop, resultLinks, lessonLinks },
        'experiment-transitions: per-org итог',
      );
    }

    return { resultLinks, lessonLinks };
  }

  private async upsertLink(args: {
    tenantId: string;
    fromEntityId: string;
    fromType: string;
    toEntityId: string;
    toType: string;
    relationType: 'result_supports_insight' | 'lesson_informs_decision';
    explanation: string;
    properties: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.entityLink.upsert({
      where: {
        fromEntityId_fromType_toEntityId_toType_relationType: {
          fromEntityId: args.fromEntityId,
          fromType: args.fromType,
          toEntityId: args.toEntityId,
          toType: args.toType,
          relationType: args.relationType,
        },
      },
      create: {
        tenantId: args.tenantId,
        fromEntityId: args.fromEntityId,
        fromType: args.fromType,
        toEntityId: args.toEntityId,
        toType: args.toType,
        relationType: args.relationType,
        confidence: new Prisma.Decimal(0.85),
        explanation: args.explanation,
        createdBy: 'reframing',
        status: 'active',
        validFrom: new Date(),
        validTo: null,
        properties: args.properties as Prisma.InputJsonValue,
      },
      update: {
        confidence: new Prisma.Decimal(0.85),
        explanation: args.explanation,
        properties: args.properties as Prisma.InputJsonValue,
        status: 'active',
        deletedAt: null,
      },
    });
  }
}
