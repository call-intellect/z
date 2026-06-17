import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

import {
  buildSilenceStatement,
  classifySilenceSeverity,
  DEFAULT_THEME_SILENCE_WEEKS,
  silenceCutoff,
  themeSilenceCauseCategory,
  weeksSilent,
} from './theme-silence-detector.scoring';

@Injectable()
export class ThemeSilenceDetectorCron {
  private readonly logger = new Logger(ThemeSilenceDetectorCron.name);
  private static readonly MAX_ORGS_PER_RUN = 5_000;
  private static readonly MAX_THEMES_PER_ORG = 5_000;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 4 * * *')
  async run(): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>(
      'dashboard.theme_silence.enabled',
      'DASHBOARD_THEME_SILENCE_ENABLED',
      true,
    );
    if (!enabled) {
      this.logger.debug('theme-silence-detector.cron: dashboard.theme_silence.enabled=false, skip');
      return;
    }
    try {
      const stats = await this.runOnce(new Date());
      this.logger.debug(stats, 'theme-silence-detector.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'theme-silence-detector.cron: непойманная ошибка',
      );
    }
  }

  async runOnce(now: Date): Promise<{
    orgsProcessed: number;
    surfaced: number;
    resolved: number;
    errors: number;
  }> {
    const weeks = await this.resolveSilenceWeeks();
    const cutoff = silenceCutoff(now, weeks);

    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: ThemeSilenceDetectorCron.MAX_ORGS_PER_RUN,
    });

    let orgsProcessed = 0;
    let surfaced = 0;
    let resolved = 0;
    let errors = 0;

    for (const org of orgs) {
      orgsProcessed++;
      try {
        const res = await this.processOrg({ tenantId: org.id, now, cutoff });
        surfaced += res.surfaced;
        resolved += res.resolved;
      } catch (err) {
        errors++;
        this.logger.warn(
          {
            tenantId: org.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'theme-silence-detector.cron: Org упал',
        );
      }
    }

    return { orgsProcessed, surfaced, resolved, errors };
  }

  private async processOrg(args: {
    tenantId: string;
    now: Date;
    cutoff: Date;
  }): Promise<{ surfaced: number; resolved: number }> {
    const { tenantId, now, cutoff } = args;

    const silentThemes = await this.prisma.theme.findMany({
      where: {
        tenantId,
        status: 'active',
        mergedIntoId: null,
        lastSignalAt: { not: null, lt: cutoff },
      },
      select: { id: true, name: true, lastSignalAt: true },
      take: ThemeSilenceDetectorCron.MAX_THEMES_PER_ORG,
    });

    let surfaced = 0;
    const silentThemeIds = new Set<string>();
    for (const theme of silentThemes) {
      if (!theme.lastSignalAt) continue;
      silentThemeIds.add(theme.id);
      const weeks = weeksSilent(theme.lastSignalAt, now);
      const severity = classifySilenceSeverity(weeks);
      const statement = buildSilenceStatement(theme.name, weeks);
      const created = await this.upsertSilenceInsight({
        tenantId,
        themeId: theme.id,
        statement,
        severity,
        now,
      });
      if (created) {
        surfaced++;
        this.metrics.incThemeSilenceSurfaced({ severity });
      }
    }

    const resolved = await this.resolveRevivedThemes({
      tenantId,
      stillSilentThemeIds: silentThemeIds,
    });

    return { surfaced, resolved };
  }

  private async upsertSilenceInsight(args: {
    tenantId: string;
    themeId: string;
    statement: string;
    severity: Prisma.InsightCreateInput['severity'];
    now: Date;
  }): Promise<boolean> {
    const causeCategory = themeSilenceCauseCategory(args.themeId);
    const existing = await this.prisma.insight.findFirst({
      where: { tenantId: args.tenantId, causeCategory },
      select: { id: true, status: true },
    });

    if (existing) {
      await this.prisma.insight.update({
        where: { id: existing.id },
        data: {
          statement: args.statement.slice(0, 2_000),
          severity: args.severity,
          lastObservedAt: args.now,
          status: existing.status === 'archived' ? 'archived' : 'active',
        },
      });
      return false;
    }

    await this.prisma.insight.create({
      data: {
        tenantId: args.tenantId,
        kind: 'risk',
        statement: args.statement.slice(0, 2_000),
        severity: args.severity,
        causeCategory,
        confidence: new Prisma.Decimal(0.7),
        dataClass: 'internal',
        firstObservedAt: args.now,
        lastObservedAt: args.now,
        dynamicLabel: 'stable',
        frequencyScore: new Prisma.Decimal(0),
        dynamicScore: new Prisma.Decimal(0),
        status: 'active',
      },
    });
    return true;
  }

  private async resolveRevivedThemes(args: {
    tenantId: string;
    stillSilentThemeIds: Set<string>;
  }): Promise<number> {
    const activeSilenceInsights = await this.prisma.insight.findMany({
      where: {
        tenantId: args.tenantId,
        status: 'active',
        causeCategory: { startsWith: 'ts:' },
      },
      select: { id: true, causeCategory: true },
      take: ThemeSilenceDetectorCron.MAX_THEMES_PER_ORG,
    });

    let resolved = 0;
    for (const ins of activeSilenceInsights) {
      const themeId = (ins.causeCategory ?? '').slice('ts:'.length);
      if (!themeId) continue;
      if (args.stillSilentThemeIds.has(themeId)) continue;
      await this.prisma.insight.update({
        where: { id: ins.id },
        data: { status: 'mitigated' },
      });
      resolved++;
    }
    return resolved;
  }

  private async resolveSilenceWeeks(): Promise<number> {
    return this.cfg.getDynamic<number>(
      'dashboard.theme_silence_weeks',
      'DASHBOARD_THEME_SILENCE_WEEKS',
      DEFAULT_THEME_SILENCE_WEEKS,
    );
  }
}
