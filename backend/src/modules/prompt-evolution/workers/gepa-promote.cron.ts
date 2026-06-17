import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class GepaPromoteCron {
  private readonly logger = new Logger(GepaPromoteCron.name);

  private readonly stalePromotePoolDays = 30;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 5 * * 0')
  async tick(): Promise<void> {
    if (!this.cfg.gepa.enabled) {
      this.logger.debug('gepa-promote cron: disabled (PROMPT_EVOLUTION_ENABLED=false)');
      return;
    }
    this.logger.debug('gepa-promote cron: START');

    await this.markStaleAsRejected().catch((err) => {
      this.logger.warn(
        `gepa-promote: stale cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    const pools = await this.prisma.promptCandidate.findMany({
      where: { status: 'pareto_pool' },
      orderBy: { createdAt: 'desc' },
    });

    const groups = new Map<string, typeof pools>();
    for (const c of pools) {
      const key = `${c.tenantId ?? 'null'}::${c.promptKey}`;
      const arr = groups.get(key) ?? [];
      arr.push(c);
      groups.set(key, arr);
    }

    let promotedCount = 0;
    for (const [, candidates] of groups) {
      if (candidates.length === 0) continue;
      candidates.sort((a, b) => compositeOf(b) - compositeOf(a));
      const top = candidates[0]!;

      const routes = await this.prisma.llmTaskRoute.findMany({
        where: {
          taskType: top.promptKey,
          OR: [{ tenantId: null }, ...(top.tenantId ? [{ tenantId: top.tenantId }] : [])],
          isActive: true,
        },
      });

      const blockedByAdmin = routes.some((r) => r.editedByAdmin);
      if (blockedByAdmin) {
        this.logger.debug(
          `gepa-promote: candidate=${top.id} promptKey=${top.promptKey} tenant=${top.tenantId ?? 'global'} — blocked by editedByAdmin=true`,
        );
        continue;
      }

      try {
        await this.prisma.promptCandidate.update({
          where: { id: top.id },
          data: {
            status: 'testing',
            abTrafficShare: this.cfg.gepa.abTrafficShare,
            abStartedAt: new Date(),
          },
        });
        promotedCount += 1;
        this.logger.debug(
          `gepa-promote: candidate=${top.id} promptKey=${top.promptKey} tenant=${top.tenantId ?? 'global'} → status=testing share=${this.cfg.gepa.abTrafficShare}`,
        );
      } catch (err) {
        this.logger.warn(
          `gepa-promote: candidate=${top.id} update failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.logger.debug(
      `gepa-promote cron: DONE — ${promotedCount}/${groups.size} candidates → testing`,
    );
  }

  private async markStaleAsRejected(): Promise<void> {
    const cutoff = new Date(Date.now() - this.stalePromotePoolDays * 24 * 60 * 60 * 1000);
    const stale = await this.prisma.promptCandidate.findMany({
      where: {
        status: 'pareto_pool',
        createdAt: { lt: cutoff },
      },
    });
    if (stale.length === 0) return;

    for (const c of stale) {
      const routes = await this.prisma.llmTaskRoute.findMany({
        where: {
          taskType: c.promptKey,
          OR: [{ tenantId: null }, ...(c.tenantId ? [{ tenantId: c.tenantId }] : [])],
          isActive: true,
        },
        select: { editedByAdmin: true },
      });
      const blockedByAdmin = routes.some((r) => r.editedByAdmin);
      const reason = blockedByAdmin ? 'admin_edit_blocks_promotion' : 'stale_in_pool';

      try {
        await this.prisma.promptCandidate.update({
          where: { id: c.id },
          data: {
            status: 'rejected',
            rejectedReason: reason,
            abEndedAt: new Date(),
          },
        });
        this.metrics.incGepaRejected({ reason });
      } catch (err) {
        this.logger.debug(
          `gepa-promote: stale update failed candidate=${c.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    this.logger.debug(`gepa-promote: stale cleanup — ${stale.length} candidates → rejected`);
  }
}

function compositeOf(c: { compositeScore: number | null; paretoMetric: unknown }): number {
  if (c.compositeScore != null && Number.isFinite(c.compositeScore)) {
    return c.compositeScore;
  }
  const m = c.paretoMetric as Record<string, unknown> | null;
  if (!m || typeof m !== 'object') return 0;
  const accuracy = typeof m.accuracy === 'number' ? m.accuracy : 0;
  const cost = typeof m.cost === 'number' ? m.cost : 0;
  const latency = typeof m.latency === 'number' ? m.latency : 0;
  return accuracy - 0.5 * cost - 0.2 * latency;
}
