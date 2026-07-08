import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { WorkerOrgGate } from '../../core-queue/worker-org-gate';
import { TaskSolutionBuildService } from '../services/task-solution-build.service';

@Injectable()
export class TaskSolutionBuildCron {
  private readonly logger = new Logger(TaskSolutionBuildCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(WorkerOrgGate) private readonly gate: WorkerOrgGate,
    @Inject(TaskSolutionBuildService)
    private readonly builder: TaskSolutionBuildService,
  ) {}

  @Cron('0 * * * *', { timeZone: 'Europe/Moscow' })
  async tick(now: Date = new Date()): Promise<void> {
    try {
      const enabled = await this.cfg.getDynamic<boolean>(
        'aiFeatures.taskSolutionEnabled',
        undefined,
        true,
      );
      if (!enabled) return;
      const hourMsk = await this.cfg.getDynamic<number>(
        'taskSolution.buildHourMsk',
        undefined,
        3,
      );
      const mskHour =
        Number(
          new Intl.DateTimeFormat('ru-RU', {
            timeZone: 'Europe/Moscow',
            hour: '2-digit',
            hour12: false,
          }).format(now),
        ) % 24;
      if (mskHour !== hourMsk) return;

      const orgs = await this.prisma.org.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });
      let created = 0;
      let updated = 0;
      for (const org of orgs) {
        try {
          await this.gate.checkOrThrow(org.id, 'task-solution-build');
        } catch {
          continue;
        }
        try {
          const s = await this.builder.runForOrg(org.id, { now });
          created += s.created;
          updated += s.updated;
          if (s.created + s.updated > 0) {
            this.logger.debug({ tenantId: org.id, ...s }, 'task-solution-build: собрано');
          }
        } catch (err) {
          this.logger.warn(
            { tenantId: org.id, err: err instanceof Error ? err.message : String(err) },
            'task-solution-build: ошибка на Org — продолжаю',
          );
        }
      }
      if (created + updated > 0) {
        this.logger.log(
          { created, updated, orgs: orgs.length },
          'task-solution-build: проход завершён',
        );
      }
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'task-solution-build: непойманная ошибка',
      );
    }
  }
}
