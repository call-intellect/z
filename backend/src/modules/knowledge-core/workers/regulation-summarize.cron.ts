import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { WorkerOrgGate } from '../../core-queue/worker-org-gate';
import { RegulationSummaryService } from '../services/regulation-summary.service';

@Injectable()
export class RegulationSummarizeCron {
  private readonly logger = new Logger(RegulationSummarizeCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(WorkerOrgGate) private readonly gate: WorkerOrgGate,
    @Inject(RegulationSummaryService) private readonly summaries: RegulationSummaryService,
  ) {}

  @Cron('25 */6 * * *')
  async sweep(): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>(
      'clone.regulations.summary.enabled',
      undefined,
      true,
    );
    if (!enabled) return;

    try {
      const orgs = await this.prisma.org.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });
      for (const org of orgs) {
        try {
          await this.gate.checkOrThrow(org.id, 'regulation-summarize');
        } catch {
          continue;
        }
        try {
          const res = await this.summaries.refreshStaleForOrg(org.id);
          if (res.generated > 0) {
            this.logger.debug(
              { tenantId: org.id, generated: res.generated, reused: res.reused },
              'regulation-summarize: обновлены саммари правил',
            );
          }
        } catch (err) {
          this.logger.warn(
            { tenantId: org.id, err: err instanceof Error ? err.message : String(err) },
            'regulation-summarize: ошибка на Org — продолжаю',
          );
        }
      }
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'regulation-summarize: непойманная ошибка',
      );
    }
  }
}
