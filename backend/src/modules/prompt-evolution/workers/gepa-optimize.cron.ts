import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';
import { GepaRunnerService } from '../services/gepa-runner.service';

/**
 * Agents v2 Фаза C2 (2026-05-30) — gepa-optimize cron (weekly Sun 04:00).
 *
 * Раз в неделю:
 *   1. Находит (tenantId × promptKey) пары с ≥30 PromptFeedback (edited)
 *      за прошлую неделю И с LlmTaskRoute.evolutionEnabled=true.
 *   2. Для каждой пары:
 *      - грузит feedback за 30 дней,
 *      - дёргает GepaRunnerService.runOptimization,
 *      - сохраняет каждый кандидат из pareto frontier в PromptCandidate
 *        со status='pareto_pool'.
 *   3. Per-(tenant, promptKey) Redis SETNX lock (TTL 7 дней).
 *
 * Master-флаг: cfg.gepa.enabled (default false). Если выключен — no-op.
 *
 * См. plans/tz/2026-05-29-agents-v2-umbrella.md §C2.
 */
@Injectable()
export class GepaOptimizeCron {
  private readonly logger = new Logger(GepaOptimizeCron.name);

  /** Минимум edited-feedback за неделю на пару (tenant, promptKey) для запуска. */
  private readonly minFeedbackPerWeek = 30;
  /** Окно feedback'ов для optimization (30 дней). */
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

    // Обновим gauge кол-ва candidates по статусам после прогона.
    await this.refreshCandidatesGauge().catch((err) => {
      this.logger.debug(
        `gepa-optimize: refreshCandidatesGauge: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    this.logger.debug('gepa-optimize cron: DONE');
  }

  /**
   * Запуск GEPA для одной пары (tenantId, promptKey). Берёт Redis SETNX lock,
   * проверяет `LlmTaskRoute.evolutionEnabled`, грузит feedback за 30 дней,
   * дёргает runner, сохраняет кандидатов.
   */
  private async runOne(tenantId: string, promptKey: string): Promise<void> {
    const lockKey = `gepa:optimize:${tenantId}:${promptKey}`;
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let locked = false;

    try {
      // TTL 7 дней — чтобы повторный weekly cron не запустился, если предыдущий
      // ещё не отработал (1ч timeout на subprocess × несколько prompt'ов
      // на одной Org может занять несколько часов).
      const ok = await this.redis.client.set(lockKey, token, 'EX', 7 * 86400, 'NX');
      if (ok !== 'OK') {
        this.logger.debug(`gepa-optimize: lock busy ${lockKey}`);
        return;
      }
      locked = true;

      // Проверка evolutionEnabled на route. Ищем primary route (с tier='primary'
      // и tenantId=null или per-tenant). evolutionEnabled живёт на каждой записи —
      // достаточно если хоть одна включена.
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

      // Seed prompt: берём promptOverride с primary tenant-specific route,
      // иначе primary global, иначе пустую строку (caller сам подмешает code-fallback).
      const primary =
        routes.find((r) => r.tenantId === tenantId && r.tier === 'primary') ??
        routes.find((r) => r.tenantId === null && r.tier === 'primary');
      const seedPrompt =
        primary?.promptOverride ??
        `(no-override) prompt for ${promptKey}: edit me`;

      const since = new Date(
        Date.now() - this.feedbackWindowDays * 24 * 60 * 60 * 1000,
      );
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
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Снимок кол-ва кандидатов по статусам в Prometheus gauge (для grafana).
   * Дёшево — простой GROUP BY.
   */
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
