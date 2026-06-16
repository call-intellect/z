import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { OnboardingRampService } from '../services/onboarding-ramp.service';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

/**
 * TZ-1 Фаза 4.E (daily-value-engine) — OnboardingRampCron.
 *
 * Ежедневный `@Cron('0 7 * * *')`: обходит активные Org →
 * `OnboardingRampService.listForTenant` → для заглохших новичков (0 активности
 * за окно `onboarding.silent_days`) шлёт:
 *   - push РУКОВОДИТЕЛЮ (глава отдела / fallback owner-admin): «новичок не
 *     активировался — подскажи бадди»;
 *   - push НОВИЧКУ: «спроси у памяти про <отдел/команду>».
 *
 * Через дневной бюджет Ф0 (priorityTier=2). Идемпотентность — дедуп по
 * proactiveNotificationId (personId + dateLocal). Master-flag
 * `operations.onboarding_ramp.enabled` (kill-switch, ON по умолчанию). БЕЗ LLM.
 */
@Injectable()
export class OnboardingRampCron {
  private readonly logger = new Logger(OnboardingRampCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(OnboardingRampService)
    private readonly svc: OnboardingRampService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 7 * * *')
  async run(): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>(
      'operations.onboarding_ramp.enabled',
      'OPERATIONS_ONBOARDING_RAMP_ENABLED',
      true,
    );
    if (!enabled) {
      this.logger.debug(
        'onboarding-ramp.cron: operations.onboarding_ramp.enabled=false, skip',
      );
      return;
    }
    try {
      const stats = await this.runOnce(new Date());
      this.logger.debug(stats, 'onboarding-ramp.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'onboarding-ramp.cron: непойманная ошибка',
      );
    }
  }

  /** Выделен для unit-тестов: произвольный `now`. */
  async runOnce(now: Date): Promise<{
    orgsProcessed: number;
    stalled: number;
    notified: number;
    errors: number;
  }> {
    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: 5_000,
    });

    let stalled = 0;
    let notified = 0;
    let errors = 0;
    const dateLocal = now.toISOString().slice(0, 10);

    for (const org of orgs) {
      const tenantTop = resolveOperationsTenantTop(org.id);
      try {
        const { items } = await this.svc.listForTenant({
          tenantId: org.id,
          now,
        });
        for (const row of items) {
          if (!row.stalled) continue;
          stalled++;
          this.metrics.incOnboardingRampStalled();
          notified += await this.notifyStalled({
            tenantId: org.id,
            personId: row.personId,
            personName: row.personName,
            newcomerUserId: row.userId,
            dateLocal,
          });
        }
      } catch (err) {
        errors++;
        this.logger.warn(
          {
            tenantId: org.id,
            tenantTop,
            err: err instanceof Error ? err.message : String(err),
          },
          'onboarding-ramp.cron: Org упал',
        );
      }
    }

    return { orgsProcessed: orgs.length, stalled, notified, errors };
  }

  /**
   * Push руководителю новичка + push самому новичку. priorityTier=2.
   * Возвращает число отправленных пушей.
   */
  private async notifyStalled(args: {
    tenantId: string;
    personId: string;
    personName: string;
    newcomerUserId: string | null;
    dateLocal: string;
  }): Promise<number> {
    let sent = 0;

    // 1) Руководителю — «новичок не активировался».
    const managerUserIds = await this.resolveManagerUserIds({
      tenantId: args.tenantId,
      personId: args.personId,
    });
    for (const userId of managerUserIds) {
      try {
        await this.conversational.sendNotification({
          tenantId: args.tenantId,
          recipientUserId: userId,
          eventType: 'proactive.notification',
          priorityTier: 2,
          payload: {
            proactiveNotificationId: `onbramp:mgr:${args.personId}:${args.dateLocal}`,
            ruleType: 'onboarding_stalled',
            severity: 'medium',
            title: 'Новичок не активировался',
            body: `${args.personName} уже несколько дней в команде, но ещё не обращался к памяти компании. Подскажите бадди / помогите включиться.`,
            actionUrl: '/dashboard/operations/onboarding-ramp',
          },
          dataClass: 'internal',
        });
        sent++;
      } catch (err) {
        this.logger.debug(
          {
            tenantId: args.tenantId,
            personId: args.personId,
            err: err instanceof Error ? err.message : String(err),
          },
          'onboarding-ramp.cron: push руководителю упал',
        );
      }
    }

    // 2) Новичку — «спроси у памяти».
    if (args.newcomerUserId) {
      try {
        await this.conversational.sendNotification({
          tenantId: args.tenantId,
          recipientUserId: args.newcomerUserId,
          eventType: 'proactive.notification',
          priorityTier: 2,
          payload: {
            proactiveNotificationId: `onbramp:new:${args.personId}:${args.dateLocal}`,
            ruleType: 'onboarding_nudge',
            severity: 'low',
            title: 'Спроси у памяти компании',
            body: 'Память компании знает, кто за что отвечает и как тут всё устроено. Задай вопрос — например, «кто разбирается в моей теме?» или «какие решения были по моему направлению?».',
            actionUrl: '/chat',
          },
          dataClass: 'internal',
        });
        sent++;
      } catch (err) {
        this.logger.debug(
          {
            tenantId: args.tenantId,
            personId: args.personId,
            err: err instanceof Error ? err.message : String(err),
          },
          'onboarding-ramp.cron: push новичку упал',
        );
      }
    }

    return sent;
  }

  /**
   * Руководитель новичка: глава его primary-отдела (≠ сам новичок). Fallback —
   * owner/admin Org (но НЕ сам новичок). Возвращает уникальные User.id.
   */
  private async resolveManagerUserIds(args: {
    tenantId: string;
    personId: string;
  }): Promise<string[]> {
    const person = await this.prisma.person.findFirst({
      where: { tenantId: args.tenantId, id: args.personId, deletedAt: null },
      select: { id: true, userId: true, primaryDepartmentId: true },
    });

    const userIds = new Set<string>();
    if (person?.primaryDepartmentId) {
      const dept = await this.prisma.department.findFirst({
        where: { id: person.primaryDepartmentId, tenantId: args.tenantId },
        select: { headPersonId: true },
      });
      if (dept?.headPersonId && dept.headPersonId !== person.id) {
        const head = await this.prisma.person.findFirst({
          where: {
            tenantId: args.tenantId,
            id: dept.headPersonId,
            deletedAt: null,
            userId: { not: null },
          },
          select: { userId: true },
        });
        if (head?.userId) userIds.add(head.userId);
      }
    }

    if (userIds.size === 0) {
      const admins = await this.prisma.membership.findMany({
        where: { orgId: args.tenantId, role: { in: ['owner', 'admin'] } },
        select: { userId: true },
        take: 5,
      });
      for (const a of admins) {
        if (a.userId && a.userId !== person?.userId) userIds.add(a.userId);
      }
    }

    return Array.from(userIds);
  }
}
