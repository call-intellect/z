import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AdminSettingsService } from '../../admin/settings/admin-settings.service';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

/** Сводка одного прохода reconcile по одной Org. */
export interface TaskReconcileTenantResult {
  /** Сколько pending-кандидатов протухло (status='pending' → 'expired'). */
  expired: number;
  /** Кандидаты-accepted всего за окно reopen-расчёта. */
  acceptedTotal: number;
  /** Из них — задача переоткрыта после accept (ложное закрытие). */
  reopened: number;
  /** Доля reopen (0..1); 0 если acceptedTotal=0. */
  reopenRate: number;
  /** Сколько пропущенных событием матчей переэмичено (best-effort). */
  reEmitted: number;
}

/**
 * TZ task-dedup (2026-06-16, Ф3) — TaskReconcileService.
 *
 * Суточный детерминированный пересчёт состояния петли «разговор → закрытие
 * задачи» (Ф2). Condition-UPDATE без LLM, идемпотентно. БЕЗ новых таблиц.
 *
 * Делает три вещи per-Org:
 *   1. Протухание pending-кандидатов: `TaskClosureCandidate(status='pending',
 *      expiresAt < now)` → `status='expired'`. Condition-UPDATE
 *      (WHERE status='pending') — повтор прогона = no-op (R10).
 *   2. Пересчёт reopen-rate: доля accepted-кандидатов, чья Issue была
 *      переоткрыта ПОСЛЕ accept (есть `IssueActivity(verb='status_changed')` с
 *      createdAt > decidedAt И Issue.completedAt IS NULL сейчас). Считается БЕЗ
 *      новых таблиц — по `TaskClosureCandidate(accepted)` + `IssueActivity` +
 *      `Issue`. Метрика gauge `task_closure_reopen_rate`; при превышении
 *      `taskClosure.reopenRateAlert` (AdminSetting, default 0.10) — WARN-алёрт
 *      (R9, R10).
 *   3. Подбор пропущенных событием матчей: canonical-блоки с completion-
 *      signalType из разговора за окно N дней, у которых нет ни одного
 *      `TaskClosureCandidate` → переэмит `task.completion_signalled`. Handler Ф2
 *      идемпотентен (`@@unique`), повторный кандидат не плодится. Best-effort.
 *
 * Сервис НИКОГДА не закрывает Issue и не трогает Decision (R13) — только
 * статус кандидата (pending→expired) + метрика + переэмит события.
 */
@Injectable()
export class TaskReconcileService {
  private readonly logger = new Logger(TaskReconcileService.name);

  /** Code-fallback порога reopen-алёрта (§7.6). Источник правды — AdminSetting. */
  private static readonly DEFAULT_REOPEN_RATE_ALERT = 0.1;
  /** Окно подбора пропущенных матчей (дни) — перекрытие сбоев event-петли. */
  private static readonly MISSED_MATCH_WINDOW_DAYS = 7;
  /** Окно расчёта reopen-rate (дни) — accepted-кандидаты за последние N дней. */
  private static readonly REOPEN_WINDOW_DAYS = 90;
  /** Completion-сигналы из разговора (= те, что эмитит RouterService Ф2). */
  private static readonly COMPLETION_SIGNAL_TYPES = [
    'task_completed',
    'task_status_changed',
    'done_item',
  ] as const;
  /** Лимит блоков на один проход подбора (защита от тяжёлого прогона). */
  private static readonly MISSED_MATCH_LIMIT = 500;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    /**
     * Чтение AdminSetting `taskClosure.reopenRateAlert`. `@Optional()` —
     * unit-тесты конструируют сервис без него; дефолт — code-fallback.
     */
    @Optional()
    @Inject(AdminSettingsService)
    private readonly settings: AdminSettingsService | null = null,
    /**
     * Для переэмита `task.completion_signalled` (подбор пропущенных матчей).
     * `@Optional()` — в тестах без event-bus подбор просто пропускается.
     */
    @Optional()
    @Inject(EventEmitter2)
    private readonly eventEmitter: EventEmitter2 | null = null,
  ) {}

  /**
   * Один проход reconcile по одной Org. Идемпотентен (condition-UPDATE).
   * Возвращает счётчики (для агрегации в cron + тестов).
   */
  async reconcileForTenant(args: {
    tenantId: string;
    now: Date;
  }): Promise<TaskReconcileTenantResult> {
    const { tenantId, now } = args;

    // 1. Протухание pending-кандидатов (condition-UPDATE, идемпотентно).
    const expired = await this.expirePending(tenantId, now);

    // 2. Пересчёт reopen-rate + метрика + алёрт.
    const reopen = await this.computeReopenRate(tenantId, now);
    this.metrics.setTaskClosureReopenRate({
      tenantTop: resolveOperationsTenantTop(tenantId),
      value: reopen.reopenRate,
    });
    await this.maybeAlert(tenantId, reopen);

    // 3. Подбор пропущенных событием матчей (best-effort, переэмит).
    const reEmitted = await this.reEmitMissedMatches(tenantId, now);

    return {
      expired,
      acceptedTotal: reopen.acceptedTotal,
      reopened: reopen.reopened,
      reopenRate: reopen.reopenRate,
      reEmitted,
    };
  }

  // ─────────────────────────── helpers ──────────────────────────────────────

  /**
   * Condition-UPDATE: pending-кандидаты с истёкшим `expiresAt` → 'expired'.
   * WHERE status='pending' гарантирует идемпотентность (повтор не тронет уже
   * протухшие / решённые). Возвращает число затронутых строк.
   */
  private async expirePending(tenantId: string, now: Date): Promise<number> {
    const res = await this.prisma.taskClosureCandidate.updateMany({
      where: {
        tenantId,
        status: 'pending',
        expiresAt: { not: null, lt: now },
      },
      data: { status: 'expired' },
    });
    return res.count;
  }

  /**
   * Reopen-rate за окно: среди accepted-кандидатов (decidedAt в окне) считаем
   * долю тех, чья Issue была переоткрыта ПОСЛЕ accept. Переоткрытие = есть
   * `IssueActivity(verb='status_changed')` с createdAt > decidedAt И сейчас
   * Issue.completedAt IS NULL (задача снова открыта). Без новых таблиц.
   */
  private async computeReopenRate(
    tenantId: string,
    now: Date,
  ): Promise<{ acceptedTotal: number; reopened: number; reopenRate: number }> {
    const windowStart = new Date(
      now.getTime() -
        TaskReconcileService.REOPEN_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const accepted = await this.prisma.taskClosureCandidate.findMany({
      where: {
        tenantId,
        status: 'accepted',
        decidedAt: { not: null, gte: windowStart },
      },
      select: { id: true, issueId: true, decidedAt: true },
      take: 10_000,
    });
    if (accepted.length === 0) {
      return { acceptedTotal: 0, reopened: 0, reopenRate: 0 };
    }

    let reopened = 0;
    for (const cand of accepted) {
      if (!cand.decidedAt) continue;
      // Задача снова открыта (completedAt обнулён при reopen, issues.service:833).
      const issue = await this.prisma.issue.findFirst({
        where: { id: cand.issueId, tenantId, completedAt: null },
        select: { id: true },
      });
      if (!issue) continue;
      // ...и был статус-переход ПОСЛЕ нашего accept (именно переоткрытие, а не
      // незакрытость по другой причине).
      const reopenActivity = await this.prisma.issueActivity.findFirst({
        where: {
          issueId: cand.issueId,
          tenantId,
          verb: 'status_changed',
          createdAt: { gt: cand.decidedAt },
        },
        select: { id: true },
      });
      if (reopenActivity) reopened++;
    }

    const reopenRate = reopened / accepted.length;
    return { acceptedTotal: accepted.length, reopened, reopenRate };
  }

  /**
   * Алёрт при reopen-rate выше порога. Механизма «push владельцу по reopen» в
   * проекте нет (ТЗ §7.6 допускает WARN-лог) — пишем WARN, чтобы он попал в
   * дашборд логов/алёртов поверх метрики `task_closure_reopen_rate`.
   */
  private async maybeAlert(
    tenantId: string,
    reopen: { acceptedTotal: number; reopened: number; reopenRate: number },
  ): Promise<void> {
    if (reopen.acceptedTotal === 0) return;
    const threshold = await this.reopenRateAlertThreshold();
    if (reopen.reopenRate <= threshold) return;
    this.logger.warn(
      {
        tenantId,
        tenantTop: resolveOperationsTenantTop(tenantId),
        acceptedTotal: reopen.acceptedTotal,
        reopened: reopen.reopened,
        reopenRate: Number(reopen.reopenRate.toFixed(3)),
        threshold,
      },
      'task-reconcile: reopen-rate выше порога — авто-закрытия из разговора часто откатываются (проверьте taskClosure.matchThreshold/autoConfirmThreshold)',
    );
  }

  /**
   * Подбор пропущенных событием матчей: canonical-блоки с completion-signalType
   * из разговора (sourceType ≠ tracker — гард внутри handler'а Ф2) за окно N
   * дней, у которых ещё нет ни одного `TaskClosureCandidate` → переэмит
   * `task.completion_signalled`. Handler Ф2 идемпотентен по `@@unique`, повтор
   * не плодит. Best-effort: без event-bus / при ошибке — просто 0.
   */
  private async reEmitMissedMatches(
    tenantId: string,
    now: Date,
  ): Promise<number> {
    if (!this.eventEmitter) return 0;
    const windowStart = new Date(
      now.getTime() -
        TaskReconcileService.MISSED_MATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    let reEmitted = 0;
    try {
      // У TaskClosureCandidate нет relation на IdeaBlock (только scalar
      // sourceBlockId) — собираем уже покрытые блоки за окно одним запросом и
      // исключаем через notIn (анти-плодёж дополнительно держит @@unique).
      const covered = await this.prisma.taskClosureCandidate.findMany({
        where: { tenantId, createdAt: { gte: windowStart } },
        select: { sourceBlockId: true },
        take: 10_000,
      });
      const coveredIds = [...new Set(covered.map((c) => c.sourceBlockId))];
      const blocks = await this.prisma.ideaBlock.findMany({
        where: {
          tenantId,
          status: 'canonical',
          signalType: {
            in: [...TaskReconcileService.COMPLETION_SIGNAL_TYPES],
          },
          createdAt: { gte: windowStart },
          mergedIntoId: null,
          supersededById: null,
          // Нет ни одного кандидата по этому блоку → событие потерялось.
          ...(coveredIds.length > 0 ? { id: { notIn: coveredIds } } : {}),
        },
        select: { id: true, signalType: true },
        take: TaskReconcileService.MISSED_MATCH_LIMIT,
      });
      for (const block of blocks) {
        const sourceType = await this.resolveBlockSourceType(block.id);
        this.eventEmitter.emit('task.completion_signalled', {
          tenantId,
          blockId: block.id,
          signalType: block.signalType,
          sourceType,
        });
        reEmitted++;
      }
    } catch (err) {
      this.logger.warn(
        {
          tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'task-reconcile: подбор пропущенных матчей упал — пропускаю (best-effort)',
      );
    }
    return reEmitted;
  }

  /** sourceType блока = sourceType самого раннего evidence (как RouterService). */
  private async resolveBlockSourceType(blockId: string): Promise<string> {
    const evidence = await this.prisma.ideaBlockEvidence.findFirst({
      where: { blockId },
      orderBy: { createdAt: 'asc' },
      select: { sourceType: true },
    });
    return evidence?.sourceType ?? 'unknown';
  }

  private async reopenRateAlertThreshold(): Promise<number> {
    if (!this.settings) {
      return TaskReconcileService.DEFAULT_REOPEN_RATE_ALERT;
    }
    const v = await this.settings
      .get<number>('taskClosure.reopenRateAlert')
      .catch(() => undefined);
    return typeof v === 'number' && Number.isFinite(v) && v >= 0
      ? v
      : TaskReconcileService.DEFAULT_REOPEN_RATE_ALERT;
  }
}
