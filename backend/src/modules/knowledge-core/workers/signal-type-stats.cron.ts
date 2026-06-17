import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { SignalType } from '@prisma/client';
import { Gauge, register } from 'prom-client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { AdminSettingsService } from '../../admin/settings/admin-settings.service';

const WINDOW_30D = 30;
const WINDOW_7D = 7;
const METRIC_DISTRIBUTION = 'kc_signal_type_distribution';

@Injectable()
export class SignalTypeStatsCron {
  private readonly logger = new Logger(SignalTypeStatsCron.name);
  private readonly distributionGauge: Gauge<'signal_type' | 'org_id'>;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminSettingsService)
    private readonly settings: AdminSettingsService,
  ) {
    this.distributionGauge = this.getOrCreateGauge();
  }

  @Cron('0 2 * * *')
  async run(): Promise<void> {
    try {
      await this.runOnce();
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'signal-type-stats.cron: непойманная ошибка',
      );
    }
  }

  async runOnce(): Promise<{ scannedOrgs: number; mutationMatrixWrites: number }> {
    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    const now = new Date();
    const window30 = daysAgo(now, WINDOW_30D);
    const window7 = daysAgo(now, WINDOW_7D);

    let writes = 0;
    for (const org of orgs) {
      try {
        await this.processOrg(org.id, window30, window7);
        writes++;
      } catch (err) {
        this.logger.warn(
          {
            tenantId: org.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'signal-type-stats: ошибка обработки Org (пропускаем)',
        );
      }
    }
    return { scannedOrgs: orgs.length, mutationMatrixWrites: writes };
  }

  async processOrg(
    tenantId: string,
    window30: Date,
    window7: Date,
  ): Promise<{
    matrix: Record<string, Record<string, number>>;
    distribution7d: Record<string, number>;
    blocks: number;
  }> {
    const blocks = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId,
        status: 'canonical',
        createdAt: { gte: window30 },
      },
      select: {
        id: true,
        signalType: true,
        createdAt: true,
        evidence: {
          select: { rawEventId: true },
          take: 1,
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (blocks.length === 0) {
      await this.settings.set(
        `signal_type_transition_matrix:${tenantId}`,
        { matrix: {}, distribution7d: {}, calculatedAt: new Date().toISOString() },
        { reason: 'signal-type-stats cron (empty Org)' },
      );
      return { matrix: {}, distribution7d: {}, blocks: 0 };
    }

    const byRaw = new Map<string, Array<{ signalType: SignalType; createdAt: Date }>>();
    for (const b of blocks) {
      const rawId = b.evidence[0]?.rawEventId;
      if (!rawId) continue;
      const arr = byRaw.get(rawId) ?? [];
      arr.push({ signalType: b.signalType, createdAt: b.createdAt });
      byRaw.set(rawId, arr);
    }

    const matrix: Record<string, Record<string, number>> = {};
    for (const list of byRaw.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      for (let i = 0; i < list.length - 1; i++) {
        const from = String(list[i]!.signalType);
        const to = String(list[i + 1]!.signalType);
        matrix[from] ??= {};
        matrix[from][to] = (matrix[from][to] ?? 0) + 1;
      }
    }

    const distribution7d: Record<string, number> = {};
    for (const b of blocks) {
      if (b.createdAt < window7) continue;
      const k = String(b.signalType);
      distribution7d[k] = (distribution7d[k] ?? 0) + 1;
    }

    await this.settings.set(
      `signal_type_transition_matrix:${tenantId}`,
      {
        matrix,
        distribution7d,
        calculatedAt: new Date().toISOString(),
      },
      { reason: 'signal-type-stats cron' },
    );

    for (const [k, v] of Object.entries(distribution7d)) {
      this.distributionGauge.set({ signal_type: k, org_id: tenantId }, v);
    }

    return { matrix, distribution7d, blocks: blocks.length };
  }

  private getOrCreateGauge(): Gauge<'signal_type' | 'org_id'> {
    const existing = register.getSingleMetric(METRIC_DISTRIBUTION);
    if (existing instanceof Gauge) {
      return existing as Gauge<'signal_type' | 'org_id'>;
    }
    return new Gauge<'signal_type' | 'org_id'>({
      name: METRIC_DISTRIBUTION,
      help: 'G.2: распределение signalType за последние 7 дней (для мониторинга drift).',
      labelNames: ['signal_type', 'org_id'],
    });
  }
}

function daysAgo(now: Date, days: number): Date {
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}
