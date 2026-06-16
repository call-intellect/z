import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { resolveOperationsTenantTop } from '../utils/tenant-top';
import { PromiseCascadeService } from '../services/promise-cascade.service';

/**
 * TZ-1 Фаза 3.C (daily-value-engine) — PromiseCascadeCron.
 *
 * Глобальный `@Cron('0 8 * * *')`: раз в день обходит активные Org →
 * `PromiseCascadeService.findCascadesForTenant` (просроченные обещания с
 * исходящей зависимостью). Для каждого:
 *   - алерт автору («твоё обещание держит работу коллеги»),
 *   - алерт руководителю owner/coo («срыв обещания X каскадит в цель Y»).
 * Через бюджет Ф0 (priorityTier 1). Метрика `promise_cascade_alert_total`.
 *
 * Master-flag `operations.promise_cascade.enabled` (kill-switch, ON). БЕЗ LLM.
 */
@Injectable()
export class PromiseCascadeCron {
  private readonly logger = new Logger(PromiseCascadeCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(PromiseCascadeService)
    private readonly svc: PromiseCascadeService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 8 * * *')
  async run(): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>(
      'operations.promise_cascade.enabled',
      'OPERATIONS_PROMISE_CASCADE_ENABLED',
      true,
    );
    if (!enabled) {
      this.logger.debug(
        'promise-cascade.cron: operations.promise_cascade.enabled=false, skip',
      );
      return;
    }
    try {
      const stats = await this.runOnce(new Date());
      this.logger.debug(stats, 'promise-cascade.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'promise-cascade.cron: непойманная ошибка',
      );
    }
  }

  /** Выделен для unit-тестов: можно передать произвольный `now`. */
  async runOnce(now: Date): Promise<{
    orgsProcessed: number;
    cascades: number;
    alertsSent: number;
    errors: number;
  }> {
    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: 5_000,
    });

    let cascades = 0;
    let alertsSent = 0;
    let errors = 0;
    const dateLocal = now.toISOString().slice(0, 10);

    for (const org of orgs) {
      const tenantTop = resolveOperationsTenantTop(org.id);
      try {
        const found = await this.svc.findCascadesForTenant({
          tenantId: org.id,
          now,
        });
        cascades += found.length;
        if (found.length === 0) continue;

        // Руководители org (owner/coo) — резолвим один раз на Org.
        const managers = await this.prisma.membership.findMany({
          where: { orgId: org.id, role: { in: ['owner', 'coo'] } },
          select: { userId: true },
        });
        const managerUserIds = managers.map((m) => m.userId);

        for (const c of found) {
          // 1. Алерт автору.
          const authorUserId = await this.resolveUserId(org.id, c.authorPersonId);
          const blocked =
            c.blockedGoalName ?? c.blockedIssueTitle ?? 'работу коллеги';
          if (authorUserId) {
            const sentA = await this.send({
              tenantId: org.id,
              recipientUserId: authorUserId,
              dedupKey: `cascade-author:${c.commitmentId}:${dateLocal}`,
              title: 'Твоё обещание держит работу коллеги',
              body: `Твоё просроченное обещание «${c.text.slice(0, 100)}» держит «${String(blocked).slice(0, 80)}». Закрой или передоговорись.`,
            });
            if (sentA) {
              alertsSent++;
              this.metrics.incPromiseCascadeAlert();
            }
          }

          // 2. Алерт руководителям.
          for (const mUserId of managerUserIds) {
            if (mUserId === authorUserId) continue; // не дублируем автору
            const sentM = await this.send({
              tenantId: org.id,
              recipientUserId: mUserId,
              dedupKey: `cascade-mgr:${c.commitmentId}:${mUserId}:${dateLocal}`,
              title: 'Срыв обещания каскадит',
              body: `Срыв обещания «${c.text.slice(0, 90)}» (${c.authorName}) каскадит в «${String(blocked).slice(0, 80)}».`,
            });
            if (sentM) {
              alertsSent++;
              this.metrics.incPromiseCascadeAlert();
            }
          }
        }
      } catch (err) {
        errors++;
        this.logger.warn(
          {
            tenantId: org.id,
            tenantTop,
            err: err instanceof Error ? err.message : String(err),
          },
          'promise-cascade.cron: Org упал',
        );
      }
    }

    return { orgsProcessed: orgs.length, cascades, alertsSent, errors };
  }

  private async resolveUserId(
    tenantId: string,
    personId: string,
  ): Promise<string | null> {
    const person = await this.prisma.person.findFirst({
      where: { tenantId, id: personId, deletedAt: null, userId: { not: null } },
      select: { userId: true },
    });
    return person?.userId ?? null;
  }

  private async send(args: {
    tenantId: string;
    recipientUserId: string;
    dedupKey: string;
    title: string;
    body: string;
  }): Promise<boolean> {
    try {
      await this.conversational.sendNotification({
        tenantId: args.tenantId,
        recipientUserId: args.recipientUserId,
        eventType: 'proactive.notification',
        priorityTier: 1,
        payload: {
          proactiveNotificationId: args.dedupKey.slice(0, 80),
          ruleType: 'promise_cascade',
          severity: 'high',
          title: args.title.slice(0, 200),
          body: args.body.slice(0, 4_000),
          actionUrl: '/me/promises',
        },
        dataClass: 'internal',
      });
      return true;
    } catch (err) {
      this.logger.debug(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'promise-cascade.cron: push упал',
      );
      return false;
    }
  }
}
