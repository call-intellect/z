import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { KnowledgeAtRiskService } from '../services/knowledge-at-risk.service';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

/**
 * TZ-1 Фаза 4.C (daily-value-engine) — KnowledgeAtRiskCron.
 *
 * Еженедельный `@Cron('0 5 * * 1')` (понедельник 05:00 UTC): обходит активные
 * Org → `KnowledgeAtRiskService.computeForTenant` (снимки знание-под-риском) →
 * для critical/warning записей с соло-экспертом шлёт push РУКОВОДИТЕЛЮ носителя
 * (глава отдела / fallback owner-admin) «продублируй зону X / поговори».
 *
 * Этика (Р8 / ТЗ Ф4.C): НОСИТЕЛЮ ничего не уходит — только руководителю.
 *
 * Master-flag `operations.knowledge_at_risk.enabled` (kill-switch, ON по
 * умолчанию). БЕЗ LLM. Метрика `knowledge_at_risk_total{severity}` — в сервисе.
 */
@Injectable()
export class KnowledgeAtRiskCron {
  private readonly logger = new Logger(KnowledgeAtRiskCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(KnowledgeAtRiskService)
    private readonly svc: KnowledgeAtRiskService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
  ) {}

  @Cron('0 5 * * 1')
  async run(): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>(
      'operations.knowledge_at_risk.enabled',
      'OPERATIONS_KNOWLEDGE_AT_RISK_ENABLED',
      true,
    );
    if (!enabled) {
      this.logger.debug(
        'knowledge-at-risk.cron: operations.knowledge_at_risk.enabled=false, skip',
      );
      return;
    }
    try {
      const stats = await this.runOnce(new Date());
      this.logger.log(stats, 'knowledge-at-risk.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'knowledge-at-risk.cron: непойманная ошибка',
      );
    }
  }

  /** Выделен для unit-тестов: произвольный `now`. */
  async runOnce(now: Date): Promise<{
    orgsProcessed: number;
    snapshots: number;
    atRisk: number;
    notified: number;
    errors: number;
  }> {
    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: 5_000,
    });

    let snapshots = 0;
    let atRisk = 0;
    let notified = 0;
    let errors = 0;

    for (const org of orgs) {
      const tenantTop = resolveOperationsTenantTop(org.id);
      try {
        const res = await this.svc.computeForTenant({
          tenantId: org.id,
          now,
        });
        snapshots += res.snapshots;
        atRisk += res.atRisk.length;
        for (const r of res.atRisk) {
          const sent = await this.notifyManager({
            tenantId: org.id,
            categoryName: r.categoryName,
            soleExpertPersonId: r.soleExpertPersonId,
            severity: r.combinedSeverity,
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
          'knowledge-at-risk.cron: Org упал',
        );
      }
    }

    return { orgsProcessed: orgs.length, snapshots, atRisk, notified, errors };
  }

  /**
   * Push руководителю носителя (глава отдела носителя; fallback — owner/admin
   * Org). Носителю — НИЧЕГО (этика). priorityTier=2 (важно, но не critical).
   * Возвращает число отправленных пушей.
   */
  private async notifyManager(args: {
    tenantId: string;
    categoryName: string;
    soleExpertPersonId: string;
    severity: string;
  }): Promise<number> {
    const managerUserIds = await this.resolveManagerUserIds({
      tenantId: args.tenantId,
      soleExpertPersonId: args.soleExpertPersonId,
    });
    if (managerUserIds.length === 0) return 0;

    let sent = 0;
    const dateLocal = new Date().toISOString().slice(0, 10);
    for (const userId of managerUserIds) {
      try {
        await this.conversational.sendNotification({
          tenantId: args.tenantId,
          recipientUserId: userId,
          eventType: 'proactive.notification',
          priorityTier: 2,
          payload: {
            proactiveNotificationId: `knowrisk:${args.soleExpertPersonId}:${args.categoryName}:${dateLocal}`,
            ruleType: 'knowledge_at_risk',
            severity: args.severity === 'critical' ? 'high' : 'medium',
            title: 'Зона знаний на одном человеке',
            body: `Зона «${args.categoryName}» держится на одном сотруднике, и он под риском ухода. Продублируйте знания / поговорите с ним.`,
            actionUrl: '/dashboard/operations/knowledge-at-risk',
          },
          dataClass: 'internal',
        });
        sent++;
      } catch (err) {
        this.logger.debug(
          {
            tenantId: args.tenantId,
            categoryName: args.categoryName,
            err: err instanceof Error ? err.message : String(err),
          },
          'knowledge-at-risk.cron: push руководителю упал',
        );
      }
    }
    return sent;
  }

  /**
   * Руководитель носителя: глава его primary-отдела (≠ сам носитель). Если не
   * нашёлся — fallback на owner/admin Org. Возвращает уникальные User.id.
   */
  private async resolveManagerUserIds(args: {
    tenantId: string;
    soleExpertPersonId: string;
  }): Promise<string[]> {
    const expert = await this.prisma.person.findFirst({
      where: {
        tenantId: args.tenantId,
        id: args.soleExpertPersonId,
        deletedAt: null,
      },
      select: { id: true, primaryDepartmentId: true },
    });

    const userIds = new Set<string>();
    if (expert?.primaryDepartmentId) {
      const dept = await this.prisma.department.findFirst({
        where: { id: expert.primaryDepartmentId, tenantId: args.tenantId },
        select: { headPersonId: true },
      });
      if (dept?.headPersonId && dept.headPersonId !== expert.id) {
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
      // Fallback — owner/admin Org (но НЕ сам носитель, если он owner/admin).
      const expertUser = await this.prisma.person.findFirst({
        where: { tenantId: args.tenantId, id: args.soleExpertPersonId },
        select: { userId: true },
      });
      const admins = await this.prisma.membership.findMany({
        where: { orgId: args.tenantId, role: { in: ['owner', 'admin'] } },
        select: { userId: true },
        take: 5,
      });
      for (const a of admins) {
        if (a.userId && a.userId !== expertUser?.userId) userIds.add(a.userId);
      }
    }

    return Array.from(userIds);
  }
}
