import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';
import { GepaRunnerService } from '../services/gepa-runner.service';

@Injectable()
export class GepaOptimizeCron {
  private readonly logger = new Logger(GepaOptimizeCron.name);

  private readonly minFeedbackPerWeek = 30;
  private readonly feedbackWindowDays = 30;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(GepaRunnerService) private readonly runner: GepaRunnerService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 4 * * 0')
  async tick(): Promise<void> {
    if (!this.cfg.gepa.enabled) {
      this.logger.debug('gepa-optimize cron: disabled (PROMPT_EVOLUTION_ENABLED=false)');
      return;
    }
    this.logger.debug('gepa-optimize cron: START');

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    type Row = { tenantId: string; promptKey: string; cnt: bigint };
    let rows: Row[];
    try {
      rows = await this.prisma.$queryRawUnsafe<Row[]>(
        `SELECT "tenantId", "promptKey", COUNT(*)::bigint AS cnt
         FROM "PromptFeedback"
         WHERE "editedOutput" IS NOT NULL AND "createdAt" >= $1
         GROUP BY "tenantId", "promptKey"
         HAVING COUNT(*) >= $2`,
        weekAgo,
        this.minFeedbackPerWeek,
      );
    } catch (err) {
      this.logger.warn(
        `gepa-optimize: query failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.logger.debug('gepa-optimize cron: DONE (errors)');
      return;
    }

    this.logger.debug(
      `gepa-optimize: ${rows.length} (tenant, promptKey) пар c ≥${this.minFeedbackPerWeek} feedback'ов`,
    );

    for (const row of rows) {
      await this.runOne(row.tenantId, row.promptKey).catch((err) => {
        this.logger.warn(
          `gepa-optimize runOne failed: tenant=${row.tenantId} promptKey=${row.promptKey}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }

    await this.refreshCandidatesGauge().catch((err) => {
      this.logger.debug(
        `gepa-optimize: refreshCandidatesGauge: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    this.logger.debug('gepa-optimize cron: DONE');
  }

  private async runOne(tenantId: string, promptKey: string): Promise<void> {
    const lockKey = `gepa:optimize:${tenantId}:${promptKey}`;
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let locked = false;

    try {
      const ok = await this.redis.client.set(lockKey, token, 'EX', 7 * 86400, 'NX');
      if (ok !== 'OK') {
        this.logger.debug(`gepa-optimize: lock busy ${lockKey}`);
        return;
      }
      locked = true;

      const routes = await this.prisma.llmTaskRoute.findMany({
        where: {
          taskType: promptKey,
          OR: [{ tenantId: null }, { tenantId }],
          isActive: true,
        },
      });
      const allDisabled = routes.length > 0 && routes.every((r) => !r.evolutionEnabled);
      if (allDisabled) {
        this.logger.debug(
          `gepa-optimize: promptKey=${promptKey} tenant=${tenantId} — evolutionEnabled=false на всех routes, skip`,
        );
        return;
      }

      const primary =
        routes.find((r) => r.tenantId === tenantId && r.tier === 'primary') ??
        routes.find((r) => r.tenantId === null && r.tier === 'primary');
      const seedPrompt =
        primary?.promptOverride ?? `(no-override) prompt for ${promptKey}: edit me`;

      const since = new Date(Date.now() - this.feedbackWindowDays * 24 * 60 * 60 * 1000);
      const feedback = await this.prisma.promptFeedback.findMany({
        where: {
          tenantId,
          promptKey,
          editedOutput: { not: null },
          createdAt: { gte: since },
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });

      const { candidates } = await this.runner.runOptimization({
        promptKey,
        feedback,
        seedPrompt,
        tenantTop: tenantTopOf(tenantId),
      });

      if (candidates.length === 0) {
        this.logger.debug(
          `gepa-optimize: promptKey=${promptKey} tenant=${tenantId} → 0 candidates`,
        );
        return;
      }

      const parentVersion = primary?.pinnedVersionNote ?? null;
      for (const c of candidates) {
        try {
          await this.prisma.promptCandidate.create({
            data: {
              tenantId,
              promptKey,
              parentVersion,
              promptText: c.text,
              paretoMetric: c.metrics as object,
              reflectionTraces: c.traces as object,
              status: 'pareto_pool',
            },
          });
        } catch (err) {
          this.logger.debug(
            `gepa-optimize: create candidate failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      this.logger.debug(
        `gepa-optimize: promptKey=${promptKey} tenant=${tenantId} → ${candidates.length} candidates saved`,
      );
    } finally {
      if (locked) {
        try {
          const cur = await this.redis.client.get(lockKey);
          if (cur === token) await this.redis.client.del(lockKey);
        } catch {}
      }
    }
  }

  private async refreshCandidatesGauge(): Promise<void> {
    const rows = await this.prisma.promptCandidate.groupBy({
      by: ['promptKey', 'status'],
      _count: { _all: true },
    });
    let abActive = 0;
    for (const row of rows) {
      this.metrics.setGepaCandidatesTotal({
        promptKey: row.promptKey,
        status: row.status,
        value: row._count._all,
      });
      if (row.status === 'testing') abActive += row._count._all;
    }
    this.metrics.setGepaAbActive({ value: abActive });
  }
}
