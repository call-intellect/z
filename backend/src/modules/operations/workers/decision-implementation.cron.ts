import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { resolveOperationsTenantTop } from '../utils/tenant-top';
import { DecisionImplementationService } from '../services/decision-implementation.service';

/**
 * TZ-1 Фаза 3.B (daily-value-engine) — DecisionImplementationCron.
 *
 * Глобальный `@Cron('0 6 * * *')`: раз в день обходит активные Org →
 * `DecisionImplementationService.computeForTenant` (пересчёт
 * implementationStatus, пометка stalled) → push ответственным
 * (`decidedByPersonIds`) по застрявшим решениям (через бюджет Ф0, priorityTier
 * 1). Агрегат «N решений не двигаются» — для COO-дайджеста (читается отдельно).
 *
 * Master-flag `operations.decision_controller.enabled` (kill-switch, ON по
 * умолчанию). БЕЗ LLM. Метрики: `decision_stalled_total`,
 * `decision_throughput_percent` (в сервисе).
 */
@Injectable()
export class DecisionImplementationCron {
  private readonly logger = new Logger(DecisionImplementationCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(DecisionImplementationService)
    private readonly svc: DecisionImplementationService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
  ) {}

  @Cron('0 6 * * *')
  async run(): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>(
      'operations.decision_controller.enabled',
      'OPERATIONS_DECISION_CONTROLLER_ENABLED',
      true,
    );
    if (!enabled) {
      this.logger.debug(
        'decision-implementation.cron: operations.decision_controller.enabled=false, skip',
      );
      return;
    }
    try {
      const stats = await this.runOnce(new Date());
      this.logger.log(stats, 'decision-implementation.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'decision-implementation.cron: непойманная ошибка',
      );
    }
  }

  /** Выделен для unit-тестов: можно передать произвольный `now`. */
  async runOnce(now: Date): Promise<{
    orgsProcessed: number;
    checked: number;
    stalled: number;
    notified: number;
    errors: number;
  }> {
    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: 5_000,
    });

    let checked = 0;
    let stalled = 0;
    let notified = 0;
    let errors = 0;

    for (const org of orgs) {
      const tenantTop = resolveOperationsTenantTop(org.id);
      try {
        const res = await this.svc.computeForTenant({ tenantId: org.id, now });
        checked += res.checked;
        stalled += res.stalled.length;
        for (const st of res.stalled) {
          const sent = await this.notifyResponsible({
            tenantId: org.id,
            decisionId: st.id,
            statement: st.statement,
            decidedByPersonIds: st.decidedByPersonIds,
          });
          notified += sent;
        }
      } catch (err) {
        errors++;
        this.logger.warn(
          {
            tenantId: org.id,
            tenantTop,
            err: err instanceof Error ? err.message : String(err),
          },
          'decision-implementation.cron: Org упал',
        );
      }
    }

    return { orgsProcessed: orgs.length, checked, stalled, notified, errors };
  }

  /**
   * Push ответственным за решение (decidedByPersonIds → Person.userId).
   * priorityTier=1 (обходит дневной бюджет — застрявшее решение важно).
   * Идемпотентность по дню обеспечивается дедупом proactiveNotificationId
   * (decisionId + dateLocal). Возвращает число отправленных пушей.
   */
  private async notifyResponsible(args: {
    tenantId: string;
    decisionId: string;
    statement: string;
    decidedByPersonIds: string[];
  }): Promise<number> {
    if (args.decidedByPersonIds.length === 0) return 0;
    const persons = await this.prisma.person.findMany({
      where: {
        tenantId: args.tenantId,
        id: { in: args.decidedByPersonIds },
        deletedAt: null,
        userId: { not: null },
      },
      select: { userId: true },
    });
    const userIds = Array.from(
      new Set(
        persons
          .map((p) => p.userId)
          .filter((u): u is string => typeof u === 'string'),
      ),
    );
    let sent = 0;
    const dateLocal = new Date().toISOString().slice(0, 10);
    for (const userId of userIds) {
      try {
        await this.conversational.sendNotification({
          tenantId: args.tenantId,
          recipientUserId: userId,
          eventType: 'proactive.notification',
          priorityTier: 1,
          payload: {
            proactiveNotificationId: `decstall:${args.decisionId}:${dateLocal}`,
            ruleType: 'decision_stalled',
            severity: 'medium',
            title: 'Решение не двигается',
            body: `Решение «${args.statement.slice(0, 120)}» не двигается: под ним нет задач и нет результатов. Создать задачи?`,
            actionUrl: '/dashboard/operations/decisions/stalled',
          },
          dataClass: 'internal',
        });
        sent++;
      } catch (err) {
        this.logger.debug(
          {
            tenantId: args.tenantId,
            decisionId: args.decisionId,
            err: err instanceof Error ? err.message : String(err),
          },
          'decision-implementation.cron: push ответственному упал',
        );
      }
    }
    return sent;
  }
}
