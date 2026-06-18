import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { WorkerOrgGate } from '../../core-queue/worker-org-gate';
import { traceForMeeting } from '../../logging/log-pipeline';
import { LogService } from '../../logging/log.service';
import { GraphMaterializationService } from '../services/graph-materialization.service';

@Injectable()
export class GraphMaterializationVerifyCron {
  private readonly logger = new Logger(GraphMaterializationVerifyCron.name);
  private static readonly MEETINGS_PER_ORG_LIMIT = 50;
  private static readonly RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
  private static readonly WORKER_NAME = 'graph-materialization-verify';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GraphMaterializationService)
    private readonly graphMat: GraphMaterializationService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(LogService) private readonly logs: LogService,
    @Inject(WorkerOrgGate) private readonly gate: WorkerOrgGate,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async sweep(): Promise<void> {
    try {
      const summary = await this.runForAllOrgs();
      this.logger.debug(summary, 'graph-materialization-verify: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'graph-materialization-verify: непойманная ошибка — повтор через 30 минут',
      );
    }
  }

  async runForAllOrgs(): Promise<{
    scannedOrgs: number;
    scannedMeetings: number;
    gapCount: number;
  }> {
    const orgs = await this.prisma.org.findMany({
      where: {
        deletedAt: null,
        memberships: {
          some: { role: { in: ['owner', 'admin'] } },
        },
      },
      select: { id: true },
    });

    const recentCutoff = new Date(Date.now() - GraphMaterializationVerifyCron.RECENT_WINDOW_MS);
    let scannedMeetings = 0;
    let gapCount = 0;

    for (const org of orgs) {
      try {
        await this.gate.checkOrThrow(org.id, GraphMaterializationVerifyCron.WORKER_NAME);
      } catch {
        this.logger.debug(
          { tenantId: org.id },
          'graph-materialization-verify: gate disabled — skip Org',
        );
        continue;
      }

      try {
        const meetings = await this.prisma.meeting.findMany({
          where: {
            tenantId: org.id,
            deletedAt: null,
            createdAt: { gte: recentCutoff },
          },
          orderBy: { createdAt: 'desc' },
          take: GraphMaterializationVerifyCron.MEETINGS_PER_ORG_LIMIT,
          select: { id: true },
        });

        for (const meeting of meetings) {
          scannedMeetings += 1;
          const result = await this.graphMat.getMeetingMaterialization(org.id, meeting.id);
          if (result.gaps.length === 0) continue;
          for (const gap of result.gaps) {
            gapCount += 1;
            this.metrics.incKcMaterializationGap({ type: gap.type });
            this.logs.write({
              level: 'WARN',
              module: GraphMaterializationVerifyCron.WORKER_NAME,
              action: 'gap',
              message: `встреча ${meeting.id}: блоки signalType=${gap.type} есть (${gap.blocksWithSignal}), записей 0`,
              traceId: traceForMeeting(meeting.id),
              orgId: org.id,
              details: gap,
            });
          }
        }
      } catch (err) {
        this.logger.warn(
          {
            tenantId: org.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'graph-materialization-verify: ошибка на Org — продолжаю',
        );
      }
    }

    return { scannedOrgs: orgs.length, scannedMeetings, gapCount };
  }
}
