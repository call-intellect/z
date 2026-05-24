import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { AuditLogService } from '../../audit/audit-log.service';
import { ProbeService } from '../../probe/probe.service';
import {
  StrategicAlignmentIssuesService,
  type GoalIssueProgressSnapshot,
} from '../services/strategic-alignment-issues.service';

/**
 * Sprint 3 B1-3.2 — Strategic Alignment Cron (issue-based).
 *
 * @Cron('0 6 * * *') — каждый день в 06:00 серверного времени.
 *
 * Что делает:
 *   1. Перебирает все Org с активными Goal (status != 'abandoned' AND
 *      archivedAt = null).
 *   2. Для каждой Goal вычисляет issue-based snapshot
 *      (`StrategicAlignmentIssuesService.compute`) — totalLinkedIssues /
 *      completedIssues / blockedIssues / timeProgressPct / alignmentScore.
 *   3. Кладёт snapshot в Redis-кэш (для быстрого чтения endpoint'ом
 *      `GET /goals/:id/alignment-snapshot`).
 *   4. Пишет историю в `AuditLog` action='goal.alignment.issue_progress'.
 *   5. Если ≥80% задач пользователя за последние 30 дней без `goalId` —
 *      эмитит probe `strategic_misalignment_high` через `ProbeService.suggest`.
 *
 * Параллельный LLM-based cron живёт в
 * `knowledge-core/workers/strategic-alignment.cron.ts` — он считает движение
 * к цели по знаниям (тематически), здесь — простые counted-метрики по задачам
 * трекера. Это не дубликат, а второй сигнал.
 */
@Injectable()
export class StrategicAlignmentCron {
  private readonly logger = new Logger(StrategicAlignmentCron.name);

  /** Откуда эмитится probe (контракт ProbeService.suggest). */
  static readonly PROBE_EMITTER = 'goals/strategic-alignment-issues';

  /** Reason для probe о misalignment'е. */
  static readonly PROBE_REASON_MISALIGNMENT = 'strategic_misalignment_high';

  constructor(
    @Inject(StrategicAlignmentIssuesService)
    private readonly snapshots: StrategicAlignmentIssuesService,
    @Inject(ProbeService) private readonly probe: ProbeService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  @Cron('0 6 * * *')
  async sweep(): Promise<void> {
    try {
      const summary = await this.runForAllOrgs();
      this.logger.log(
        summary,
        'strategic-alignment-issues.cron: проход завершён',
      );
      void this.audit.log({
        action: 'goal.alignment.issue_progress.scheduled',
        metadata: summary,
      });
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'strategic-alignment-issues.cron: непойманная ошибка — повтор завтра',
      );
    }
  }

  /**
   * Public для возможности ручного запуска (e.g. админ-эндпоинт) и тестов.
   */
  async runForAllOrgs(): Promise<{
    orgsScanned: number;
    goalsProcessed: number;
    snapshotsWritten: number;
    probesEmitted: number;
    failures: number;
  }> {
    const orgs = await this.snapshots.listOrgsWithActiveGoals();
    let goalsProcessed = 0;
    let snapshotsWritten = 0;
    let probesEmitted = 0;
    let failures = 0;

    for (const tenantId of orgs) {
      try {
        const goals = await this.snapshots.listActiveGoalsForOrg(tenantId);
        for (const goal of goals) {
          goalsProcessed += 1;
          try {
            const snapshot = await this.snapshots.compute({
              tenantId,
              goalId: goal.id,
            });
            await this.snapshots.setCached(snapshot);
            snapshotsWritten += 1;
            await this.writeAudit(snapshot);
          } catch (err) {
            failures += 1;
            this.logger.warn(
              {
                tenantId,
                goalId: goal.id,
                err: err instanceof Error ? err.message : String(err),
              },
              'strategic-alignment-issues.cron: ошибка compute/cache для goal — продолжаю',
            );
          }
        }
        // Probe-trigger per-Org (один сетевой запрос на Org, всех misaligned
        // пользователей раскидываем по отдельным probe-событиям).
        const emitted = await this.emitMisalignmentProbes({ tenantId });
        probesEmitted += emitted;
      } catch (err) {
        failures += 1;
        this.logger.warn(
          {
            tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'strategic-alignment-issues.cron: ошибка на Org — продолжаю',
        );
      }
    }

    return {
      orgsScanned: orgs.length,
      goalsProcessed,
      snapshotsWritten,
      probesEmitted,
      failures,
    };
  }

  // ─────────────────────────── helpers ────────────────────────────────

  private async writeAudit(snapshot: GoalIssueProgressSnapshot): Promise<void> {
    await this.audit.log({
      action: 'goal.alignment.issue_progress',
      resourceId: snapshot.goalId,
      metadata: {
        tenantId: snapshot.tenantId,
        totalLinkedIssues: snapshot.totalLinkedIssues,
        completedIssues: snapshot.completedIssues,
        blockedIssues: snapshot.blockedIssues,
        recentlyUpdatedIssues: snapshot.recentlyUpdatedIssues,
        timeProgressPct: snapshot.timeProgressPct,
        alignmentScore: snapshot.alignmentScore,
        computedAt: snapshot.computedAt,
      },
    });
  }

  private async emitMisalignmentProbes(args: {
    tenantId: string;
  }): Promise<number> {
    const candidates = await this.snapshots.findMisalignedUsers({
      tenantId: args.tenantId,
    });
    if (candidates.length === 0) return 0;
    let emitted = 0;
    for (const c of candidates) {
      try {
        const ratioPct = Math.round(c.ratio * 100);
        const res = await this.probe.suggest({
          tenantId: args.tenantId,
          emittedByService: StrategicAlignmentCron.PROBE_EMITTER,
          reason: StrategicAlignmentCron.PROBE_REASON_MISALIGNMENT,
          payload: {
            message: `У вас ${ratioPct}% задач не привязаны к целям компании. Хотите проверить?`,
            suggestedQuestion:
              'У вас 80% задач не привязаны к целям компании. Хотите проверить?',
            // Дополнительные метаданные для UI/auditа probe-карточки.
            totalIssues: c.totalIssues,
            issuesWithoutGoal: c.issuesWithoutGoal,
            ratio: c.ratio,
            // Сериализуем в contextIds для дедуп-hash'а: один и тот же
            // юзер в пределах TTL не получит повторно.
            contextIds: [`user:${c.userId}`],
          },
          recipientCandidates: [c.userId],
          priorityHint: 0.5,
        });
        if ('ok' in res) emitted += 1;
      } catch (err) {
        this.logger.warn(
          {
            tenantId: args.tenantId,
            userId: c.userId,
            err: err instanceof Error ? err.message : String(err),
          },
          'strategic-alignment-issues.cron: probe.suggest упал для пользователя — продолжаю',
        );
      }
    }
    return emitted;
  }
}
