import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';

import { RouterService } from './router.service';

export interface IdeaBlockUpdatedEvent {
  tenantId: string;
  blockId: string;
  changeKind: 'updated' | 'merged' | 'entity_merged' | 'projection_rebuild_emitted_by_self';
  emittedAt?: number;
}

export type ProjectionKind =
  | 'decision'
  | 'insight'
  | 'idea'
  | 'card'
  | 'regulation'
  | 'process'
  | 'policy'
  | 'skill_trait'
  | 'process_template'
  | 'experiment';

const PROJECTION_SPECIALIST: Record<Exclude<ProjectionKind, 'card'>, string> = {
  decision: RouterService.SPECIALIST.DECISIONS,
  insight: RouterService.SPECIALIST.INSIGHTS,
  idea: RouterService.SPECIALIST.IDEAS,
  regulation: RouterService.SPECIALIST.REGULATIONS,
  process: RouterService.SPECIALIST.REGULATIONS,
  policy: RouterService.SPECIALIST.REGULATIONS,
  skill_trait: RouterService.SPECIALIST.SKILL,
  process_template: RouterService.SPECIALIST.PROCESS_DETECTOR,
  experiment: RouterService.SPECIALIST.EXPERIMENT_TRACKER,
};

@Injectable()
export class ProjectionRebuilderService {
  private readonly logger = new Logger(ProjectionRebuilderService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  @OnEvent('idea_block.updated')
  async onIdeaBlockUpdated(event: IdeaBlockUpdatedEvent): Promise<void> {
    if (event.changeKind === 'projection_rebuild_emitted_by_self') {
      this.logger.debug({ blockId: event.blockId }, 'projection-rebuild: self-emitted — ignore');
      return;
    }

    const startedAt = event.emittedAt ?? Date.now();
    const debounceMs = this.cfg.projectionRebuild.debounceMs;

    const settle = async <T>(label: string, p: Promise<T[]>): Promise<T[]> => {
      try {
        return await p;
      } catch (err) {
        this.logger.warn(
          {
            label,
            blockId: event.blockId,
            err: err instanceof Error ? err.message : String(err),
          },
          'projection-rebuilder: подзапрос проекции упал — пропуск',
        );
        return [];
      }
    };

    try {
      const [
        decisions,
        insights,
        ideas,
        cards,
        regulations,
        processes,
        policies,
        skillTraits,
        processTemplates,
        experiments,
      ] = await Promise.all([
        settle(
          'decision',
          this.prisma.decision.findMany({
            where: {
              tenantId: event.tenantId,
              sourceBlockIds: { has: event.blockId },
            },
            select: { id: true },
          }),
        ),
        settle(
          'insight',
          this.prisma.insight.findMany({
            where: {
              tenantId: event.tenantId,
              sourceBlockIds: { has: event.blockId },
            },
            select: { id: true },
          }),
        ),
        settle(
          'idea',
          this.prisma.idea.findMany({
            where: {
              tenantId: event.tenantId,
              sourceBlockIds: { has: event.blockId },
            },
            select: { id: true },
          }),
        ),
        settle(
          'card',
          this.prisma.card.findMany({
            where: {
              tenantId: event.tenantId,
              sourceBlockIds: { has: event.blockId },
            },
            select: { id: true },
          }),
        ),
        settle(
          'regulation',
          this.prisma.regulation.findMany({
            where: {
              tenantId: event.tenantId,
              sourceBlockIds: { has: event.blockId },
            },
            select: { id: true },
          }),
        ),
        settle(
          'process',
          this.prisma.process.findMany({
            where: {
              tenantId: event.tenantId,
              sourceBlockIds: { has: event.blockId },
            },
            select: { id: true },
          }),
        ),
        settle(
          'policy',
          this.prisma.policy.findMany({
            where: {
              tenantId: event.tenantId,
              sourceBlockIds: { has: event.blockId },
            },
            select: { id: true },
          }),
        ),
        settle(
          'skill_trait',
          this.prisma.skillTrait.findMany({
            where: {
              profile: { tenantId: event.tenantId },
              sourceBlockIds: { has: event.blockId },
            },
            select: { id: true },
          }),
        ),
        settle(
          'process_template',
          this.prisma.processTemplate.findMany({
            where: {
              tenantId: event.tenantId,
              sourceBlockIds: { has: event.blockId },
            },
            select: { id: true },
          }),
        ),
        settle(
          'experiment',
          this.prisma.experiment.findMany({
            where: {
              tenantId: event.tenantId,
              sourceBlockIds: { has: event.blockId },
            },
            select: { id: true },
          }),
        ),
      ]);

      const tasks: Array<Promise<void>> = [];
      const enqueueSpecialist = (kind: Exclude<ProjectionKind, 'card'>, ids: { id: string }[]) => {
        for (const row of ids) {
          tasks.push(
            this.enqueueProjectionRebuild({
              kind,
              projectionId: row.id,
              blockId: event.blockId,
              tenantId: event.tenantId,
              specialistName: PROJECTION_SPECIALIST[kind],
              debounceMs,
            }),
          );
        }
      };
      enqueueSpecialist('decision', decisions);
      enqueueSpecialist('insight', insights);
      enqueueSpecialist('idea', ideas);
      enqueueSpecialist('regulation', regulations);
      enqueueSpecialist('process', processes);
      enqueueSpecialist('policy', policies);
      enqueueSpecialist('skill_trait', skillTraits);
      enqueueSpecialist('process_template', processTemplates);
      enqueueSpecialist('experiment', experiments);

      for (const c of cards) {
        tasks.push(this.enqueueCardRebuild(c.id, debounceMs));
      }

      await Promise.allSettled(tasks);

      this.metrics?.observeKcProjectionRebuildLagMs(Date.now() - startedAt);

      this.logger.debug(
        {
          blockId: event.blockId,
          changeKind: event.changeKind,
          counts: {
            decisions: decisions.length,
            insights: insights.length,
            ideas: ideas.length,
            cards: cards.length,
            regulations: regulations.length,
            processes: processes.length,
            policies: policies.length,
            skillTraits: skillTraits.length,
            processTemplates: processTemplates.length,
            experiments: experiments.length,
          },
        },
        'projection-rebuild: enqueue завершён',
      );
    } catch (err) {
      this.logger.warn(
        {
          blockId: event.blockId,
          err: err instanceof Error ? err.message : String(err),
        },
        'projection-rebuild: глобальная ошибка обработки события — пропускаем',
      );
    }
  }

  private async enqueueProjectionRebuild(args: {
    kind: Exclude<ProjectionKind, 'card'>;
    projectionId: string;
    blockId: string;
    tenantId: string;
    specialistName: string;
    debounceMs: number;
  }): Promise<void> {
    const jobId = `projection-rebuild_${args.kind}_${args.projectionId}`;
    try {
      await this.coreQueue.enqueueSpecialistRoutingWithCustomJobId({
        specialistName: args.specialistName,
        blockId: args.blockId,
        tenantId: args.tenantId,
        signalType: 'projection_rebuild',
        jobId,
        delayMs: args.debounceMs,
      });
      this.metrics?.incKcProjectionRebuild({ type: args.kind });
    } catch (err) {
      this.logger.warn(
        {
          kind: args.kind,
          projectionId: args.projectionId,
          jobId,
          err: err instanceof Error ? err.message : String(err),
        },
        'projection-rebuild: enqueue упал — пропускаем эту проекцию',
      );
    }
  }

  private async enqueueCardRebuild(cardId: string, debounceMs: number): Promise<void> {
    try {
      await this.coreQueue.enqueueCardRollupV2(cardId, {
        delayMs: debounceMs,
        reason: 'projection-rebuild',
      });
      this.metrics?.incKcProjectionRebuild({ type: 'card' });
    } catch (err) {
      this.logger.warn(
        {
          cardId,
          err: err instanceof Error ? err.message : String(err),
        },
        'projection-rebuild: enqueueCardRollupV2 упал — пропускаем',
      );
    }
  }
}
