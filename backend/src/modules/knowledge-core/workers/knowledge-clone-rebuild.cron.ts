import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';

@Injectable()
export class KnowledgeCloneRebuildCron {
  private readonly logger = new Logger(KnowledgeCloneRebuildCron.name);
  private static readonly MIN_REBUILD_INTERVAL_MS = 6 * 60 * 60 * 1000;
  private static readonly FRESH_ACTIVITY_DAYS = 7;
  private static readonly MAX_PERSONS_PER_SWEEP = 200;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Cron('0 */6 * * *')
  async sweep(): Promise<void> {
    try {
      const summary = await this.runOnce();
      this.logger.debug(summary, 'knowledge-clone-rebuild.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'knowledge-clone-rebuild.cron: непойманная ошибка — повтор по расписанию',
      );
    }
  }

  async runOnce(): Promise<{
    orgsScanned: number;
    personsEnqueued: number;
    enqueueFailures: number;
  }> {
    void this.cfg;

    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });

    let personsEnqueued = 0;
    let enqueueFailures = 0;

    const cutoff = new Date(Date.now() - KnowledgeCloneRebuildCron.MIN_REBUILD_INTERVAL_MS);
    const freshSince = new Date(
      Date.now() - KnowledgeCloneRebuildCron.FRESH_ACTIVITY_DAYS * 24 * 60 * 60 * 1000,
    );

    for (const org of orgs) {
      const candidates = await this.prisma.person.findMany({
        where: {
          tenantId: org.id,
          relationship: 'employee',
          deletedAt: null,
          entityId: { not: null },
          OR: [{ lastProfileBuildAt: null }, { lastProfileBuildAt: { lt: cutoff } }],
        },
        select: { id: true, entityId: true },
        take: KnowledgeCloneRebuildCron.MAX_PERSONS_PER_SWEEP,
      });
      if (candidates.length === 0) continue;

      const entityIds = candidates
        .map((c) => c.entityId)
        .filter((id): id is string => typeof id === 'string');
      if (entityIds.length === 0) continue;

      const freshMentions = await this.prisma.ideaBlockEntity.findMany({
        where: {
          entityId: { in: entityIds },
          role: { in: ['subject', 'mentioned'] },
          block: {
            tenantId: org.id,
            status: 'canonical',
            createdAt: { gte: freshSince },
          },
        },
        select: { entityId: true },
      });
      const freshEntities = new Set(freshMentions.map((m) => m.entityId));

      for (const cand of candidates) {
        if (!cand.entityId || !freshEntities.has(cand.entityId)) continue;
        try {
          await this.coreQueue.enqueueRebuildKnowledgeProfile({
            tenantId: org.id,
            personId: cand.id,
            reason: 'knowledge-clone.cron',
            delayMs: 0,
          });
          personsEnqueued++;
        } catch (err) {
          enqueueFailures++;
          this.logger.warn(
            {
              personId: cand.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'knowledge-clone-rebuild.cron: enqueue упал — пропускаю',
          );
        }
      }
    }

    return {
      orgsScanned: orgs.length,
      personsEnqueued,
      enqueueFailures,
    };
  }
}
