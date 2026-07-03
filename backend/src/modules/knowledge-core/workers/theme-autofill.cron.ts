import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { WorkerOrgGate } from '../../core-queue/worker-org-gate';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';
import { ThemeFillService } from '../services/theme-fill.service';

interface AutofillOpts {
  enabled: boolean;
  threshold: number;
  scanWindowDays: number;
  maxPerScan: number;
  dedupeSimilarity: number;
}

@Injectable()
export class ThemeAutofillCron {
  private readonly logger = new Logger(ThemeAutofillCron.name);
  private static readonly MAX_THEMES_PER_ORG = 200;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(ThemeFillService) private readonly fill: ThemeFillService,
    @Inject(WorkerOrgGate) private readonly gate: WorkerOrgGate,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('35 * * * *')
  async sweep(): Promise<void> {
    try {
      const summary = await this.runForAllOrgs();
      this.logger.debug(summary, 'theme-autofill: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'theme-autofill: непойманная ошибка — повтор через час',
      );
    }
  }

  async runForAllOrgs(): Promise<{
    scannedOrgs: number;
    filledThemes: number;
    addedTotal: number;
  }> {
    const opts = await this.cfg.themeAutofillOpts();
    if (!opts.enabled) {
      this.logger.debug('theme-autofill: kill-switch off — пропуск прохода');
      return { scannedOrgs: 0, filledThemes: 0, addedTotal: 0 };
    }

    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });

    let filledThemes = 0;
    let addedTotal = 0;

    for (const org of orgs) {
      try {
        const added = await this.runForOrg(org.id, opts);
        if (added > 0) {
          filledThemes += 1;
          addedTotal += added;
        }
      } catch (err) {
        this.logger.warn(
          {
            tenantId: org.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'theme-autofill: ошибка на Org — продолжаю',
        );
      }
    }

    return { scannedOrgs: orgs.length, filledThemes, addedTotal };
  }

  private async runForOrg(tenantId: string, opts: AutofillOpts): Promise<number> {
    try {
      await this.gate.checkOrThrow(tenantId, 'theme-autofill');
    } catch {
      this.logger.debug({ tenantId }, 'theme-autofill: gate disabled — skip Org');
      return 0;
    }

    const themes = await this.prisma.theme.findMany({
      where: { tenantId, origin: 'user', status: 'active' },
      select: { id: true },
      take: ThemeAutofillCron.MAX_THEMES_PER_ORG,
    });
    if (themes.length === 0) return 0;

    let added = 0;
    for (const t of themes) {
      const res = await this.fill.fillTheme({
        tenantId,
        themeId: t.id,
        opts: {
          threshold: opts.threshold,
          scanWindowDays: opts.scanWindowDays,
          maxPerScan: opts.maxPerScan,
          dedupeSimilarity: opts.dedupeSimilarity,
        },
      });
      added += res.added;
    }

    if (added > 0) {
      this.metrics.incThemeAutofillAdded({
        tenantTop: tenantTopOf(tenantId),
        count: added,
      });
    }

    this.logger.debug(
      { tenantId, scannedThemes: themes.length, added },
      'theme-autofill: org обработан',
    );
    return added;
  }
}
