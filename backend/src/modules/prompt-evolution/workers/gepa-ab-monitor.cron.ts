import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * Agents v2 Фаза C2 (2026-05-30) — gepa-ab-monitor cron (каждые 15 минут).
 *
 * Для каждого PromptCandidate(status='testing'):
 *   - Считает composite score за последние 48ч на двух наборах invocations:
 *     A = `experimentGroup != 'gepa_candidate'` (контроль) для того же
 *         (promptKey, tenantId).
 *     B = `experimentGroup = 'gepa_candidate'` (вариант) для того же
 *         (promptKey, tenantId).
 *   - Composite метрика: `1 - avg(editDistance)` за окно (через
 *     PromptFeedback с editedOutput). Если данных мало (< abMin... B) —
 *     ждём. Если данных нет даже у A — лог + skip.
 *
 *   Решения:
 *     - `compositeB < compositeA - cfg.gepa.abRejectThreshold` (default 0.10):
 *       → status='rejected', rejectedReason='ab_deg_detected'.
 *       Метрика `incGepaRollback({reason:'ab_deg'})`.
 *     - `compositeB > compositeA + cfg.gepa.abPromoteThreshold` (default 0.05)
 *       AND B invocations ≥ cfg.gepa.abMinInvocationsBeforeDecision (100):
 *       → promote: запись candidate.promptText в LlmTaskRoute.promptOverride +
 *         pinnedVersionNote='Auto-promoted by GEPA YYYY-MM-DD'.
 *         candidate.status='promoted', promotedAt=NOW.
 *         Метрика `incGepaPromoted({promptKey})`.
 *     - Иначе: продолжаем тестировать.
 *
 * Master-флаг: cfg.gepa.enabled. Если выключен — no-op.
 *
 * См. plans/tz/2026-05-29-agents-v2-umbrella.md §C2.
 */
@Injectable()
export class GepaAbMonitorCron {
  private readonly logger = new Logger(GepaAbMonitorCron.name);

  /** Окно агрегации (48ч). */
  private readonly windowHours = 48;

  /** Метка experimentGroup, которую LlmRouter ставит invocations'у с candidate'ом. */
  static readonly EXPERIMENT_GROUP_LABEL = 'gepa_candidate';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('*/15 * * * *')
  async tick(): Promise<void> {
    if (!this.cfg.gepa.enabled) {
      this.logger.debug('gepa-ab-monitor cron: disabled');
      return;
    }

    const testing = await this.prisma.promptCandidate.findMany({
      where: { status: 'testing' },
    });
    if (testing.length === 0) return;

    this.logger.debug(`gepa-ab-monitor: ${testing.length} candidates в testing`);

    for (const c of testing) {
      try {
        await this.evaluateOne(c);
      } catch (err) {
        this.logger.warn(
          `gepa-ab-monitor: candidate=${c.id} eval failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Обновим gauge активных A/B.
    try {
      const stillTesting = await this.prisma.promptCandidate.count({
        where: { status: 'testing' },
      });
      this.metrics.setGepaAbActive({ value: stillTesting });
    } catch {
      // ignore
    }
  }

  /**
   * Оценка одного candidate'а. Принимает решение promote / reject / continue.
   */
  private async evaluateOne(c: {
    id: string;
    tenantId: string | null;
    promptKey: string;
    promptText: string;
  }): Promise<void> {
    const since = new Date(Date.now() - this.windowHours * 60 * 60 * 1000);

    // A: invocations без gepa_candidate group. B: с gepa_candidate.
    // experimentGroup живёт на AiUsageLog. PromptFeedback ссылается на
    // AiUsageLog.id через invocationId — берём через subquery.
    const groupRows = await this.prisma.$queryRawUnsafe<
      Array<{ grp: 'A' | 'B'; cnt: bigint; avg_dist: number | null }>
    >(
      `WITH joined AS (
         SELECT
           CASE WHEN ul."experimentGroup" = $1 THEN 'B' ELSE 'A' END AS grp,
           pf."editDistance" AS dist
         FROM "PromptFeedback" pf
         JOIN "AiUsageLog" ul ON ul.id = pf."invocationId"
         WHERE pf."promptKey" = $2
           AND pf."createdAt" >= $3
           AND pf."editedOutput" IS NOT NULL
           AND ($4::text IS NULL OR pf."tenantId" = $4)
       )
       SELECT grp, COUNT(*)::bigint AS cnt, AVG(dist)::float AS avg_dist
       FROM joined
       GROUP BY grp`,
      GepaAbMonitorCron.EXPERIMENT_GROUP_LABEL,
      c.promptKey,
      since,
      c.tenantId,
    );

    let countA = 0;
    let avgDistA = 0;
    let countB = 0;
    let avgDistB = 0;
    for (const row of groupRows) {
      if (row.grp === 'A') {
        countA = Number(row.cnt);
        avgDistA = row.avg_dist ?? 0;
      } else if (row.grp === 'B') {
        countB = Number(row.cnt);
        avgDistB = row.avg_dist ?? 0;
      }
    }

    // Composite score: 1 - avgEditDistance. Чем меньше правок, тем выше score.
    // Это упрощённая метрика — sub-TZ §C2 допускает расширение в будущем.
    const compositeA = countA > 0 ? 1 - avgDistA : 0;
    const compositeB = countB > 0 ? 1 - avgDistB : 0;

    // Обновим candidate state (evaluations + compositeScore) для админ-UI.
    try {
      await this.prisma.promptCandidate.update({
        where: { id: c.id },
        data: {
          evaluations: countB,
          compositeScore: compositeB,
        },
      });
    } catch {
      // best-effort
    }

    if (countA === 0) {
      this.logger.debug(
        `gepa-ab-monitor: candidate=${c.id} promptKey=${c.promptKey} — no A control data, skip`,
      );
      return;
    }

    // Решение reject: B заметно хуже A. Делаем даже при малом N (защита).
    if (
      countB >= 10 &&
      compositeB < compositeA - this.cfg.gepa.abRejectThreshold
    ) {
      await this.prisma.promptCandidate.update({
        where: { id: c.id },
        data: {
          status: 'rejected',
          rejectedReason: 'ab_deg_detected',
          abEndedAt: new Date(),
        },
      });
      this.metrics.incGepaRejected({ reason: 'ab_deg_detected' });
      this.metrics.incGepaRollback({ reason: 'ab_deg' });
      this.logger.warn(
        `gepa-ab-monitor: candidate=${c.id} promptKey=${c.promptKey} — REJECTED (A=${compositeA.toFixed(3)}, B=${compositeB.toFixed(3)}, n_a=${countA}, n_b=${countB})`,
      );
      return;
    }

    // Решение promote: B заметно лучше + достаточно invocations.
    if (
      countB >= this.cfg.gepa.abMinInvocationsBeforeDecision &&
      compositeB > compositeA + this.cfg.gepa.abPromoteThreshold
    ) {
      await this.promoteToLlmRoute(c, compositeB);
      return;
    }

    this.logger.debug(
      `gepa-ab-monitor: candidate=${c.id} continue (A=${compositeA.toFixed(3)}, B=${compositeB.toFixed(3)}, n_b=${countB})`,
    );
  }

  /**
   * Промоут candidate'а в LlmTaskRoute.promptOverride. Если existing route
   * нет — создаёт legacy запись с tenantId+taskType (одна без tier).
   *
   * Не трогает editedByAdmin (если бы он был true — gepa-promote cron не
   * перевёл бы candidate в testing). По итогу промоута выставляем
   * `pinnedVersionNote='Auto-promoted by GEPA YYYY-MM-DD'` для audit.
   */
  private async promoteToLlmRoute(
    c: {
      id: string;
      tenantId: string | null;
      promptKey: string;
      promptText: string;
    },
    compositeB: number,
  ): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const note = `Auto-promoted by GEPA ${today} (score ${compositeB.toFixed(3)})`;

    // Берём primary route. Если несколько — обновляем все primary одной
    // транзакцией: promptOverride + pinnedVersionNote.
    const routes = await this.prisma.llmTaskRoute.findMany({
      where: {
        taskType: c.promptKey,
        ...(c.tenantId ? { tenantId: c.tenantId } : { tenantId: null }),
        isActive: true,
        tier: 'primary',
      },
    });

    if (routes.length === 0) {
      // Нет primary route → создаём legacy entry (один в одном).
      try {
        await this.prisma.llmTaskRoute.create({
          data: {
            tenantId: c.tenantId,
            taskType: c.promptKey,
            isActive: true,
            promptOverride: c.promptText,
            pinnedVersionNote: note,
          },
        });
      } catch (err) {
        this.logger.warn(
          `gepa-ab-monitor: promote create route failed candidate=${c.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
    } else {
      for (const r of routes) {
        try {
          await this.prisma.llmTaskRoute.update({
            where: { id: r.id },
            data: {
              promptOverride: c.promptText,
              pinnedVersionNote: note,
            },
          });
        } catch (err) {
          this.logger.warn(
            `gepa-ab-monitor: promote update route ${r.id} failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    await this.prisma.promptCandidate.update({
      where: { id: c.id },
      data: {
        status: 'promoted',
        promotedAt: new Date(),
        abEndedAt: new Date(),
        compositeScore: compositeB,
      },
    });

    this.metrics.incGepaPromoted({ promptKey: c.promptKey });
    this.logger.log(
      `gepa-ab-monitor: candidate=${c.id} promptKey=${c.promptKey} tenant=${c.tenantId ?? 'global'} → PROMOTED (score ${compositeB.toFixed(3)})`,
    );
  }
}
