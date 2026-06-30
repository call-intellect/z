import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class ProbeDialogTtlCron {
  private readonly logger = new Logger(ProbeDialogTtlCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('17 * * * *')
  async sweep(): Promise<void> {
    const ttlHours = await this.cfg.getDynamic<number>(
      'probe.dialogConfirmTtlHours',
      undefined,
      48,
    );
    const cutoff = new Date(Date.now() - ttlHours * 60 * 60 * 1000);
    const stale = await this.prisma.probeDialogState.findMany({
      where: {
        phase: { in: ['awaiting_clarification', 'awaiting_confirmation'] },
        updatedAt: { lt: cutoff },
      },
      select: { id: true, probeEventId: true, phase: true, tenantId: true },
    });
    if (stale.length === 0) return;
    for (const s of stale) {
      try {
        await this.prisma.probeDialogState.update({
          where: { id: s.id },
          data: { phase: 'resolved' },
        });
        await this.prisma.probeEvent.updateMany({
          where: { id: s.probeEventId, tenantId: s.tenantId },
          data: { status: 'abandoned' },
        });
        this.metrics.incProbeDialogTransition({ from: s.phase, to: 'resolved' });
        this.metrics.incProbeDialogOutcome({ outcome: 'abandoned' });
      } catch (err) {
        this.logger.warn(
          { id: s.id, err: err instanceof Error ? err.message : String(err) },
          'probe-dialog-ttl: перевод в abandoned упал — пропускаю',
        );
      }
    }
    this.logger.log(`probe-dialog-ttl: ${stale.length} диалогов переведено в abandoned`);
  }
}
