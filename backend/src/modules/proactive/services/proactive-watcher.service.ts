import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { getLocalHour } from '../../operations/utils/local-date';
import { getProactiveLocalDate } from '../utils/local-date';

import { ProactiveDedupService } from './proactive-dedup.service';
import { ProactiveMessageCraftService } from './proactive-message-craft.service';

@Injectable()
export class ProactiveWatcherService {
  private readonly logger = new Logger(ProactiveWatcherService.name);

  private static readonly RULE_TIMEOUT_MS = 60_000;
  private static readonly MAX_NOTIFICATIONS_PER_RULE_PER_ORG = 50;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(ProactiveDedupService)
    private readonly dedup: ProactiveDedupService,
    @Inject(ProactiveMessageCraftService)
    private readonly craft: ProactiveMessageCraftService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async runOnce(now: Date = new Date()): Promise<{
    orgsScanned: number;
    rulesExecuted: number;
    rulesSkippedDisabled: number;
    rulesTimedOut: number;
    notificationsSent: number;
    dedupSkipped: number;
  }> {
    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null, isReferenceDemo: false },
      select: { id: true },
    });

    const rules = this.buildEnabledRules();

    let rulesExecuted = 0;
    let rulesSkippedDisabled = 0;
    let rulesTimedOut = 0;
    let notificationsSent = 0;
    let dedupSkipped = 0;

    for (const org of orgs) {
      for (const rule of rules) {
        if (!rule.enabled) {
          rulesSkippedDisabled++;
          continue;
        }
        const startedAt = Date.now();
        try {
          const result = await this.runRuleWithTimeout(rule.code, () =>
            rule.runner({ tenantId: org.id, now }),
          );
          rulesExecuted++;
          notificationsSent += result.sent;
          dedupSkipped += result.dedupSkipped;
        } catch (err) {
          if (err instanceof RuleTimeoutError) {
            rulesTimedOut++;
            this.logger.warn(
              {
                rule: rule.code,
                tenantId: org.id,
                budgetMs: ProactiveWatcherService.RULE_TIMEOUT_MS,
              },
              'proactive-watcher: правило не уложилось в budget — skip до следующего тика',
            );
          } else {
            this.logger.error(
              {
                rule: rule.code,
                tenantId: org.id,
                err: err instanceof Error ? err.message : String(err),
              },
              'proactive-watcher: непойманная ошибка правила',
            );
          }
        } finally {
          const seconds = (Date.now() - startedAt) / 1000;
          this.metrics.observeProactiveRuleDuration({
            rule: rule.code,
            seconds,
          });
        }
      }
    }

    return {
      orgsScanned: orgs.length,
      rulesExecuted,
      rulesSkippedDisabled,
      rulesTimedOut,
      notificationsSent,
      dedupSkipped,
    };
  }

  private buildEnabledRules(): Array<{
    code: string;
    enabled: boolean;
    runner: (args: {
      tenantId: string;
      now: Date;
    }) => Promise<{ sent: number; dedupSkipped: number }>;
  }> {
    const flags = this.cfg.proactive.rules;
    return [
      {
        code: 'decision_no_owner',
        enabled: flags.decisionNoOwner,
        runner: (a) => this.ruleDecisionNoOwner(a),
      },
      {
        code: 'insight_no_mitigation',
        enabled: flags.insightNoMitigation,
        runner: (a) => this.ruleInsightNoMitigation(a),
      },
      {
        code: 'experiment_running_too_long',
        enabled: flags.experimentRunningTooLong,
        runner: (a) => this.ruleExperimentRunningTooLong(a),
      },
      {
        code: 'process_stale_review',
        enabled: flags.processStaleReview,
        runner: (a) => this.ruleProcessStaleReview(a),
      },
      {
        code: 'role_low_completeness',
        enabled: flags.roleLowCompleteness,
        runner: (a) => this.ruleRoleLowCompleteness(a),
      },
      {
        code: 'department_no_domain',
        enabled: flags.departmentNoDomain,
        runner: (a) => this.ruleDepartmentNoDomain(a),
      },
      {
        code: 'insights_siloed_in_domain',
        enabled: flags.insightsSiloedInDomain,
        runner: (a) => this.ruleInsightsSiloedInDomain(a),
      },
      {
        code: 'plan_item_overdue',
        enabled: flags.planItemOverdue,
        runner: (a) => this.rulePlanItemOverdue(a),
      },
    ];
  }

  private async ruleDecisionNoOwner(args: {
    tenantId: string;
    now: Date;
  }): Promise<{ sent: number; dedupSkipped: number }> {
    const threshold = new Date(args.now.getTime() - 3 * 24 * 3600 * 1000);
    const candidates = await this.prisma.decision.findMany({
      where: {
        tenantId: args.tenantId,
        deletedAt: null,
        createdAt: { lt: threshold },
        status: { in: ['approved', 'proposed'] as never[] },
        decidedByPersonIds: { isEmpty: true },
      },
      select: { id: true, statement: true, text: true, createdAt: true },
      take: ProactiveWatcherService.MAX_NOTIFICATIONS_PER_RULE_PER_ORG,
      orderBy: { createdAt: 'asc' },
    });
    if (candidates.length === 0) return { sent: 0, dedupSkipped: 0 };

    const recipient = await this.firstAdminUserId(args.tenantId);
    if (!recipient) return { sent: 0, dedupSkipped: 0 };

    let sent = 0;
    let dedupSkipped = 0;
    for (const d of candidates) {
      const ageDays = Math.floor((args.now.getTime() - d.createdAt.getTime()) / (24 * 3600 * 1000));
      const name = (d.statement ?? d.text ?? 'без названия').slice(0, 80);
      const result = await this.emit({
        tenantId: args.tenantId,
        userId: recipient,
        ruleType: 'decision_no_owner',
        severity: ageDays > 14 ? 'high' : ageDays > 7 ? 'medium' : 'low',
        now: args.now,
        facts: {
          name,
          decisionId: d.id,
          ageDays,
        },
        actionUrl: `/decisions/${d.id}`,
      });
      if (result === 'sent') sent++;
      else if (result === 'dedup_skipped') dedupSkipped++;
    }
    return { sent, dedupSkipped };
  }

  private async ruleInsightNoMitigation(args: {
    tenantId: string;
    now: Date;
  }): Promise<{ sent: number; dedupSkipped: number }> {
    const candidates = await this.prisma.insight.findMany({
      where: {
        tenantId: args.tenantId,
        status: 'active',
        mitigationPlan: null,
        sourceBlockIds: { isEmpty: false },
      },
      select: {
        id: true,
        statement: true,
        severity: true,
        sourceBlockIds: true,
        frequencyScore: true,
        lastObservedAt: true,
      },
      take: ProactiveWatcherService.MAX_NOTIFICATIONS_PER_RULE_PER_ORG * 2,
      orderBy: { lastObservedAt: 'desc' },
    });
    const filtered = candidates.filter((i) => i.sourceBlockIds.length >= 3);
    if (filtered.length === 0) return { sent: 0, dedupSkipped: 0 };

    const recipient = await this.firstAdminUserId(args.tenantId);
    if (!recipient) return { sent: 0, dedupSkipped: 0 };

    let sent = 0;
    let dedupSkipped = 0;
    for (const i of filtered.slice(0, ProactiveWatcherService.MAX_NOTIFICATIONS_PER_RULE_PER_ORG)) {
      const result = await this.emit({
        tenantId: args.tenantId,
        userId: recipient,
        ruleType: 'insight_no_mitigation',
        severity: i.severity === 'critical' ? 'high' : i.severity === 'high' ? 'medium' : 'low',
        now: args.now,
        facts: {
          name: i.statement.slice(0, 80),
          insightId: i.id,
          frequency: i.sourceBlockIds.length,
        },
        actionUrl: `/insights/${i.id}`,
      });
      if (result === 'sent') sent++;
      else if (result === 'dedup_skipped') dedupSkipped++;
    }
    return { sent, dedupSkipped };
  }

  private async ruleExperimentRunningTooLong(args: {
    tenantId: string;
    now: Date;
  }): Promise<{ sent: number; dedupSkipped: number }> {
    const threshold = new Date(args.now.getTime() - 30 * 24 * 3600 * 1000);
    const candidates = await this.prisma.experiment.findMany({
      where: {
        tenantId: args.tenantId,
        status: 'running',
        startedAt: { lt: threshold },
        currentResult: null,
      },
      select: {
        id: true,
        name: true,
        startedAt: true,
        ownerEntityId: true,
      },
      take: ProactiveWatcherService.MAX_NOTIFICATIONS_PER_RULE_PER_ORG,
      orderBy: { startedAt: 'asc' },
    });
    if (candidates.length === 0) return { sent: 0, dedupSkipped: 0 };

    const recipient = await this.firstAdminUserId(args.tenantId);
    if (!recipient) return { sent: 0, dedupSkipped: 0 };

    let sent = 0;
    let dedupSkipped = 0;
    for (const e of candidates) {
      const ageDays = Math.floor(
        (args.now.getTime() - (e.startedAt?.getTime() ?? args.now.getTime())) / (24 * 3600 * 1000),
      );
      const result = await this.emit({
        tenantId: args.tenantId,
        userId: recipient,
        ruleType: 'experiment_running_too_long',
        severity: ageDays > 60 ? 'high' : 'medium',
        now: args.now,
        facts: { name: e.name.slice(0, 80), experimentId: e.id, ageDays },
        actionUrl: `/experiments/${e.id}`,
      });
      if (result === 'sent') sent++;
      else if (result === 'dedup_skipped') dedupSkipped++;
    }
    return { sent, dedupSkipped };
  }

  private async ruleProcessStaleReview(args: {
    tenantId: string;
    now: Date;
  }): Promise<{ sent: number; dedupSkipped: number }> {
    const threshold = new Date(args.now.getTime() - 90 * 24 * 3600 * 1000);
    const candidates = await this.prisma.process.findMany({
      where: {
        tenantId: args.tenantId,
        status: 'active',
        deletedAt: null,
        updatedAt: { lt: threshold },
      },
      select: {
        id: true,
        name: true,
        updatedAt: true,
        ownerPersonId: true,
        ownerPerson: { select: { userId: true } },
      },
      take: ProactiveWatcherService.MAX_NOTIFICATIONS_PER_RULE_PER_ORG,
      orderBy: { updatedAt: 'asc' },
    });
    if (candidates.length === 0) return { sent: 0, dedupSkipped: 0 };

    const adminFallback = await this.firstAdminUserId(args.tenantId);

    let sent = 0;
    let dedupSkipped = 0;
    for (const p of candidates) {
      const recipient = p.ownerPerson?.userId ?? adminFallback;
      if (!recipient) continue;
      const ageDays = Math.floor((args.now.getTime() - p.updatedAt.getTime()) / (24 * 3600 * 1000));
      const result = await this.emit({
        tenantId: args.tenantId,
        userId: recipient,
        ruleType: 'process_stale_review',
        severity: ageDays > 180 ? 'medium' : 'low',
        now: args.now,
        facts: { name: p.name.slice(0, 80), processId: p.id, ageDays },
        actionUrl: `/processes/${p.id}`,
      });
      if (result === 'sent') sent++;
      else if (result === 'dedup_skipped') dedupSkipped++;
    }
    return { sent, dedupSkipped };
  }

  private async ruleRoleLowCompleteness(args: {
    tenantId: string;
    now: Date;
  }): Promise<{ sent: number; dedupSkipped: number }> {
    const roles = await this.prisma.role.findMany({
      where: {
        tenantId: args.tenantId,
        deletedAt: null,
        OR: [{ maturityScore: { lt: 0.5 } }, { maturityScore: null }],
      },
      select: {
        id: true,
        name: true,
        maturityScore: true,
        _count: { select: { personRoles: true, appointments: true } },
      },
      take: ProactiveWatcherService.MAX_NOTIFICATIONS_PER_RULE_PER_ORG * 2,
    });
    const filtered = roles.filter(
      (r) => (r._count.personRoles ?? 0) + (r._count.appointments ?? 0) > 5,
    );
    if (filtered.length === 0) return { sent: 0, dedupSkipped: 0 };

    const recipient = await this.firstAdminUserId(args.tenantId);
    if (!recipient) return { sent: 0, dedupSkipped: 0 };

    let sent = 0;
    let dedupSkipped = 0;
    for (const r of filtered.slice(0, ProactiveWatcherService.MAX_NOTIFICATIONS_PER_RULE_PER_ORG)) {
      const people = (r._count.personRoles ?? 0) + (r._count.appointments ?? 0);
      const result = await this.emit({
        tenantId: args.tenantId,
        userId: recipient,
        ruleType: 'role_low_completeness',
        severity: people > 15 ? 'medium' : 'low',
        now: args.now,
        facts: {
          name: r.name.slice(0, 80),
          roleId: r.id,
          maturityScore: r.maturityScore ? Number(r.maturityScore) : null,
          peopleAttached: people,
        },
        actionUrl: `/structure/roles/${r.id}`,
      });
      if (result === 'sent') sent++;
      else if (result === 'dedup_skipped') dedupSkipped++;
    }
    return { sent, dedupSkipped };
  }

  private async ruleDepartmentNoDomain(args: {
    tenantId: string;
    now: Date;
  }): Promise<{ sent: number; dedupSkipped: number }> {
    const departments = await this.prisma.department.findMany({
      where: {
        tenantId: args.tenantId,
        deletedAt: null,
        domainLinks: { none: {} },
      },
      select: { id: true, name: true },
      take: ProactiveWatcherService.MAX_NOTIFICATIONS_PER_RULE_PER_ORG,
    });
    if (departments.length === 0) return { sent: 0, dedupSkipped: 0 };

    const recipient = await this.firstAdminUserId(args.tenantId);
    if (!recipient) return { sent: 0, dedupSkipped: 0 };

    let sent = 0;
    let dedupSkipped = 0;
    for (const dpt of departments) {
      const result = await this.emit({
        tenantId: args.tenantId,
        userId: recipient,
        ruleType: 'department_no_domain',
        severity: 'low',
        now: args.now,
        facts: { name: dpt.name.slice(0, 80), departmentId: dpt.id },
        actionUrl: `/structure/departments/${dpt.id}`,
      });
      if (result === 'sent') sent++;
      else if (result === 'dedup_skipped') dedupSkipped++;
    }
    return { sent, dedupSkipped };
  }

  private async ruleInsightsSiloedInDomain(args: {
    tenantId: string;
    now: Date;
  }): Promise<{ sent: number; dedupSkipped: number }> {
    const domains = await this.prisma.functionalDomain.findMany({
      where: { tenantId: args.tenantId, deletedAt: null },
      select: { id: true, name: true, slug: true },
      take: 200,
    });
    if (domains.length === 0) return { sent: 0, dedupSkipped: 0 };

    const isolatedCount = await this.prisma.insight.count({
      where: {
        tenantId: args.tenantId,
        status: 'active',
        relatedDecisionIds: { isEmpty: true },
      },
    });
    if (isolatedCount < 3) return { sent: 0, dedupSkipped: 0 };

    const recipient = await this.firstAdminUserId(args.tenantId);
    if (!recipient) return { sent: 0, dedupSkipped: 0 };

    const firstDomain = domains[0]!;
    const result = await this.emit({
      tenantId: args.tenantId,
      userId: recipient,
      ruleType: 'insights_siloed_in_domain',
      severity: isolatedCount > 10 ? 'medium' : 'low',
      now: args.now,
      facts: {
        name: firstDomain.name.slice(0, 80),
        domainId: firstDomain.id,
        isolatedInsightsCount: isolatedCount,
      },
      actionUrl: '/insights?filter=no_linked_decision',
    });
    return {
      sent: result === 'sent' ? 1 : 0,
      dedupSkipped: result === 'dedup_skipped' ? 1 : 0,
    };
  }

  private async rulePlanItemOverdue(args: {
    tenantId: string;
    now: Date;
  }): Promise<{ sent: number; dedupSkipped: number }> {
    if (!this.cfg.proactive.eveningPlanCheckEnabled) {
      return { sent: 0, dedupSkipped: 0 };
    }
    const thresholdDays = this.cfg.proactive.planItemOverdueThresholdDays;
    const since = new Date(args.now.getTime() - thresholdDays * 24 * 3600 * 1000);
    const morningCheckIns = await this.prisma.dailyCheckIn.findMany({
      where: {
        tenantId: args.tenantId,
        kind: 'morning',
        createdAt: { gte: since },
        plansJson: { not: { equals: null } as never },
      },
      select: {
        id: true,
        personId: true,
        dateLocal: true,
        createdAt: true,
        plansJson: true,
        person: { select: { userId: true, name: true, timezone: true } },
      },
      take: 150,
      orderBy: { createdAt: 'desc' },
    });
    if (morningCheckIns.length === 0) return { sent: 0, dedupSkipped: 0 };

    const byPerson = new Map<string, typeof morningCheckIns>();
    for (const m of morningCheckIns) {
      const arr = byPerson.get(m.personId) ?? [];
      arr.push(m);
      byPerson.set(m.personId, arr);
    }

    const eveningLocalHour = this.cfg.betaOps.eveningLocalHour;

    let sent = 0;
    let dedupSkipped = 0;
    let processed = 0;
    for (const [personId, ms] of byPerson) {
      if (processed >= ProactiveWatcherService.MAX_NOTIFICATIONS_PER_RULE_PER_ORG) break;
      processed++;
      const latest = ms[0]!;

      const localHour = getLocalHour(args.now, latest.person?.timezone);
      if (localHour < eveningLocalHour) continue;

      const eveningDone = await this.prisma.dailyCheckIn.count({
        where: {
          tenantId: args.tenantId,
          personId,
          kind: 'evening',
          dateLocal: latest.dateLocal,
          donesJson: { not: { equals: null } as never },
        },
      });
      if (eveningDone > 0) continue;

      const recipient = latest.person?.userId;
      if (!recipient) continue;

      const planItems = this.extractPlanItemTexts(latest.plansJson);
      const name =
        planItems.length === 0
          ? `план от ${latest.dateLocal}`
          : planItems.length === 1
            ? `Не закрыто: ${planItems[0]}`
            : `Не закрыто: ${planItems.slice(0, 2).join('; ')}`;
      const result = await this.emit({
        tenantId: args.tenantId,
        userId: recipient,
        ruleType: 'plan_item_overdue',
        severity: 'low',
        now: args.now,
        facts: {
          name,
          planItems,
          checkInId: latest.id,
          dateLocal: latest.dateLocal,
        },
        actionUrl: '/me/check-ins',
      });
      if (result === 'sent') sent++;
      else if (result === 'dedup_skipped') dedupSkipped++;
    }
    return { sent, dedupSkipped };
  }

  private extractPlanItemTexts(plansJson: unknown): string[] {
    if (!Array.isArray(plansJson)) return [];
    const texts: string[] = [];
    for (const raw of plansJson) {
      if (texts.length >= 5) break;
      if (raw && typeof raw === 'object' && 'text' in raw) {
        const text = (raw as { text: unknown }).text;
        if (typeof text === 'string' && text.trim().length > 0) {
          texts.push(text.trim().slice(0, 80));
        }
      }
    }
    return texts;
  }

  private async emit(input: {
    tenantId: string;
    userId: string;
    ruleType: string;
    severity: 'low' | 'medium' | 'high';
    now: Date;
    facts: Record<string, unknown>;
    actionUrl?: string;
  }): Promise<'sent' | 'dedup_skipped' | 'skipped'> {
    const dateLocal = getProactiveLocalDate(input.now);
    const acquired = await this.dedup.acquire({
      tenantId: input.tenantId,
      userId: input.userId,
      dateLocal,
    });
    if (!acquired) {
      this.metrics.incProactiveDedupSkipped();
      return 'dedup_skipped';
    }

    const crafted = await this.craft.craft({
      tenantId: input.tenantId,
      userId: input.userId,
      ruleType: input.ruleType,
      severity: input.severity,
      facts: input.facts,
    });

    let row;
    try {
      row = await this.prisma.proactiveNotification.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId,
          ruleType: input.ruleType,
          severity: input.severity,
          payloadJson: {
            facts: input.facts,
            actionUrl: input.actionUrl ?? null,
            title: crafted.title,
            body: crafted.body,
            craftedByLlm: crafted.fromLlm,
          } as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(
        {
          rule: input.ruleType,
          tenantId: input.tenantId,
          userId: input.userId,
          err: err instanceof Error ? err.message : String(err),
        },
        'proactive: create ProactiveNotification failed — skip',
      );
      return 'skipped';
    }

    try {
      const notif = await this.conversational.sendNotification({
        tenantId: input.tenantId,
        recipientUserId: input.userId,
        eventType: 'proactive.notification',
        payload: {
          proactiveNotificationId: row.id,
          ruleType: input.ruleType,
          severity: input.severity,
          title: crafted.title,
          body: crafted.body,
          ...(input.actionUrl ? { actionUrl: input.actionUrl } : {}),
        },
        dataClass: 'internal',
      });
      await this.prisma.proactiveNotification.update({
        where: { id: row.id },
        data: { notificationId: notif.id },
      });
      this.metrics.incProactiveEmitted({
        rule: input.ruleType,
        severity: input.severity,
      });
      return 'sent';
    } catch (err) {
      this.logger.warn(
        {
          rule: input.ruleType,
          tenantId: input.tenantId,
          userId: input.userId,
          proactiveNotificationId: row.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'proactive: sendNotification failed — оставляем ProactiveNotification без notificationId',
      );
      this.metrics.incProactiveEmitted({
        rule: input.ruleType,
        severity: input.severity,
      });
      return 'sent';
    }
  }

  private async firstAdminUserId(tenantId: string): Promise<string | null> {
    const membership = await this.prisma.membership.findFirst({
      where: {
        orgId: tenantId,
        role: { in: ['owner', 'admin'] },
      },
      orderBy: { joinedAt: 'asc' },
      select: { userId: true },
    });
    return membership?.userId ?? null;
  }

  private async runRuleWithTimeout<T>(ruleCode: string, fn: () => Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new RuleTimeoutError(ruleCode)),
        ProactiveWatcherService.RULE_TIMEOUT_MS,
      );
    });
    try {
      return await Promise.race([fn(), timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private tenantTop(tenantId: string): string {
    if (!tenantId) return 'other';
    try {
      const hash = createHash('sha1').update(tenantId).digest();
      const slice = hash.readUInt32BE(0);
      return `t${slice % 100}`;
    } catch {
      return 'other';
    }
  }
}

class RuleTimeoutError extends Error {
  constructor(readonly ruleCode: string) {
    super(`proactive-watcher: rule '${ruleCode}' timed out`);
    this.name = 'RuleTimeoutError';
  }
}
