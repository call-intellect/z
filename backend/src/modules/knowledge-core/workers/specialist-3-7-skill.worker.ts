import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Job } from 'bullmq';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';
import { type SpecialistRoutingJobData } from '../../core-queue/queues';
import { RouterService } from '../services/router.service';
import { Specialist37Service } from '../services/specialist-3-7-skill.service';

/**
 * SBA γ-1 — Specialist 3.7 (SkillProfile) handler.
 *
 * Handler очереди `core.specialist-routing` с jobName='3-7-skill'.
 * Вызывается из `SpecialistRoutingDispatcherWorker.dispatch`, когда
 * RouterService.dispatch диспатчит блок (signalType='reasoning' с
 * employee-subject) этому специалисту.
 *
 * Логика:
 *   1. Получить block (фильтр по signalType ∈ reasoning/rationale/decision_basis,
 *      block.status='canonical').
 *   2. Через IdeaBlockEntity.role='subject' найти subject-Person'у этого блока.
 *   3. Проверить, что Person.relationship='employee'.
 *   4. Через Specialist37Service.getOrCreateForPerson создать/получить профиль.
 *   5. enqueueRebuildSkillProfile (debounce 60s) для этого профиля.
 *
 * НЕ делает: LLM-extraction, KNN-merge, persist traits — это в
 * SkillProfileRebuildWorker (через Specialist37Service.rebuildProfile).
 */
@Injectable()
export class Specialist37SkillWorker {
  private readonly logger = new Logger(Specialist37SkillWorker.name);

  static readonly SPECIALIST_NAME = RouterService.SPECIALIST.SKILL;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(Specialist37Service)
    private readonly specialist: Specialist37Service,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async handle(job: Job<SpecialistRoutingJobData>): Promise<void> {
    const start = Date.now();
    const { blockId, tenantId } = job.data;
    try {
      const block = await this.prisma.ideaBlock.findUnique({
        where: { id: blockId },
        select: {
          id: true,
          tenantId: true,
          status: true,
          signalType: true,
        },
      });
      if (!block) {
        this.logger.debug({ blockId }, 'specialist-3-7: блок не найден — skip');
        return;
      }
      if (block.tenantId !== tenantId) {
        this.logger.warn(
          { blockId, expected: tenantId, actual: block.tenantId },
          'specialist-3-7: tenant mismatch — skip',
        );
        return;
      }
      if (block.status !== 'canonical') {
        this.logger.debug(
          { blockId, status: block.status },
          'specialist-3-7: блок не canonical — skip',
        );
        return;
      }
      if (
        block.signalType !== 'reasoning' &&
        block.signalType !== 'rationale' &&
        block.signalType !== 'decision_basis'
      ) {
        this.logger.debug(
          { blockId, signalType: block.signalType },
          'specialist-3-7: signalType вне области специалиста — skip',
        );
        return;
      }

      // Найти subject-Person'ов блока.
      const mentions = await this.prisma.ideaBlockEntity.findMany({
        where: {
          blockId: block.id,
          role: 'subject',
          entity: { type: 'person' },
        },
        select: { entityId: true },
      });
      const entityIds = [...new Set(mentions.map((m) => m.entityId))];
      if (entityIds.length === 0) {
        this.logger.debug(
          { blockId },
          'specialist-3-7: subject-Person отсутствует — skip',
        );
        return;
      }

      const persons = await this.prisma.person.findMany({
        where: {
          tenantId,
          entityId: { in: entityIds },
          relationship: 'employee',
          deletedAt: null,
        },
        select: { id: true },
        take: 10,
      });
      if (persons.length === 0) {
        this.logger.debug(
          { blockId, entityIds },
          'specialist-3-7: subject не employee — skip',
        );
        return;
      }

      for (const p of persons) {
        try {
          const profile = await this.specialist.getOrCreateForPerson({
            tenantId,
            personId: p.id,
          });
          if (!profile) continue;
          await this.coreQueue.enqueueRebuildSkillProfile({
            tenantId,
            profileId: profile.id,
            reason: `specialist-3-7:block:${blockId}`,
          });
        } catch (err) {
          this.logger.warn(
            {
              blockId,
              personId: p.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'specialist-3-7: enqueueRebuild упал — пропускаю Person',
          );
        }
      }

      this.logger.log(
        {
          blockId,
          personsDispatched: persons.length,
        },
        'specialist-3-7: enqueue rebuild для затронутых сотрудников',
      );
    } finally {
      this.metrics.observeCoreSpecialistPipelineDuration({
        type: Specialist37Service.METRIC_TYPE,
        seconds: (Date.now() - start) / 1000,
      });
    }
  }
}
