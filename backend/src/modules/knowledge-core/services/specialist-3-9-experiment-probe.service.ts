import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Experiment } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ActivityFeedService } from '../../activity-feed/services/activity-feed.service';

import { OwnerResolverService } from './owner-resolver.service';

@Injectable()
export class Specialist39ExperimentProbeService {
  private readonly logger = new Logger(Specialist39ExperimentProbeService.name);

  static readonly SPECIALIST_NAME = '3-9-experiments';
  private static readonly CRON_BATCH_LIMIT = 100;
  private static readonly NO_OWNER_AGE_HOURS = 24;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Optional()
    @Inject(OwnerResolverService)
    private readonly ownerResolver?: OwnerResolverService,
    @Optional()
    @Inject(ActivityFeedService)
    private readonly activityFeed?: ActivityFeedService,
  ) {}

  async checkNoOwnerForOrg(tenantId: string): Promise<number> {
    const cutoff = new Date(
      Date.now() - Specialist39ExperimentProbeService.NO_OWNER_AGE_HOURS * 3600 * 1000,
    );
    const experiments = await this.prisma.experiment.findMany({
      where: {
        tenantId,
        ownerEntityId: null,
        status: { in: ['hypothesis', 'running'] },
        createdAt: { lt: cutoff },
      },
      take: Specialist39ExperimentProbeService.CRON_BATCH_LIMIT,
    });
    let autoAssigned = 0;
    for (const exp of experiments) {
      try {
        const ladder = await this.tryResolveOwner(exp);
        if (ladder.outcome === 'auto') autoAssigned += 1;
      } catch (err) {
        this.logErr('experiment.no_owner', exp.id, err);
      }
    }
    return autoAssigned;
  }

  private async tryResolveOwner(
    exp: Experiment,
  ): Promise<
    | { outcome: 'auto' }
    | { outcome: 'already_assigned' }
    | { outcome: 'ambiguous'; candidateNames: string[] }
    | { outcome: 'none' }
  > {
    if (!this.ownerResolver) return { outcome: 'none' };
    try {
      const subjects =
        exp.personSubjectIds.length > 0
          ? await this.prisma.person.findMany({
              where: {
                id: { in: exp.personSubjectIds },
                tenantId: exp.tenantId,
                deletedAt: null,
                userId: { not: null },
              },
              select: { id: true, name: true, userId: true, entityId: true },
              take: 20,
            })
          : [];
      const candidatePool = [
        ...new Set(subjects.map((p) => p.userId).filter((u): u is string => !!u)),
      ];
      const resolution = await this.ownerResolver.resolve({
        tenantId: exp.tenantId,
        candidatePool,
      });

      if (resolution.kind === 'resolved') {
        const person = subjects.find((p) => p.userId === resolution.userId);
        if (person?.entityId) {
          const updated = await this.prisma.experiment.updateMany({
            where: { id: exp.id, tenantId: exp.tenantId, ownerEntityId: null },
            data: { ownerEntityId: person.entityId },
          });
          if (updated.count > 0) {
            this.metrics.incOwnerResolution({ outcome: 'auto' });
            this.logger.log(
              `owner-resolver: Кора назначила ответственного за эксперимент «${exp.name.slice(0, 80)}» — ${person.name} (experimentId=${exp.id})`,
            );
            await this.publishAutoAssignFeed(exp, person.name);
            return { outcome: 'auto' };
          }
          this.logger.log(
            `owner-resolver: владелец эксперимента уже назначен параллельно — пропускаю (experimentId=${exp.id})`,
          );
          return { outcome: 'already_assigned' };
        }
        this.metrics.incOwnerResolution({ outcome: 'none' });
        return { outcome: 'none' };
      }
      if (resolution.kind === 'ambiguous') {
        this.metrics.incOwnerResolution({ outcome: 'ambiguous' });
        const names = subjects
          .filter((p) => p.userId && resolution.candidates.includes(p.userId))
          .map((p) => p.name)
          .filter((n) => n.length > 0);
        if (names.length >= 2) {
          return { outcome: 'ambiguous', candidateNames: names };
        }
        return { outcome: 'none' };
      }
      this.metrics.incOwnerResolution({ outcome: 'none' });
      return { outcome: 'none' };
    } catch (err) {
      this.logErr('experiment.no_owner.owner_resolver', exp.id, err);
      return { outcome: 'none' };
    }
  }

  private async publishAutoAssignFeed(exp: Experiment, personName: string): Promise<void> {
    if (!this.activityFeed) return;
    try {
      await this.activityFeed.publish({
        tenantId: exp.tenantId,
        feedType: 'knowledge_change',
        sourceType: 'system',
        sourceAgentName: Specialist39ExperimentProbeService.SPECIALIST_NAME,
        relatedEntityType: 'experiment',
        relatedEntityId: exp.id,
        title: `Кора назначила ответственного за эксперимент «${exp.name.slice(0, 80)}»: ${personName}`,
        summary:
          'Ответственный выведен автоматически по «лестнице владельца» (единственный участник-кандидат эксперимента).',
        severity: 'normal',
        visibility: 'public_org',
      });
    } catch (err) {
      this.logger.warn(
        {
          experimentId: exp.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-9 probe: publish в ленту не удался — назначение уже применено',
      );
    }
  }

  private logErr(reason: string, id: string, err: unknown): void {
    this.logger.warn(
      {
        resourceId: id,
        reason,
        err: err instanceof Error ? err.message : String(err),
      },
      'specialist-3-9 probe: внутренняя ошибка триггера — пропускаю',
    );
  }
}
