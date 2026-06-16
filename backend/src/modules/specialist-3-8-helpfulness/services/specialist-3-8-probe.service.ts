import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { ProbeService } from '../../probe/probe.service';

@Injectable()
export class Specialist38ProbeService {
  private readonly logger = new Logger(Specialist38ProbeService.name);

  static readonly SPECIALIST_NAME = '3-8-helpfulness';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(ProbeService)
    private readonly probeService?: ProbeService,
  ) {}

  async runAllChecks(args: { tenantId: string }): Promise<{
    emitted: number;
    skipped: number;
  }> {
    let emitted = 0;
    let skipped = 0;
    const trackers = [
      () => this.checkNewExpertiseHelper(args),
      () => this.checkUnrecognizedHighContributor(args),
      () => this.checkMentorEmerging(args),
      () => this.checkQuestionChainUnanswered(args),
    ];
    for (const t of trackers) {
      try {
        const n = await t();
        emitted += n;
      } catch (err) {
        skipped += 1;
        this.logger.warn(
          {
            tenantId: args.tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'specialist-3-8.probe: trigger упал — skip',
        );
      }
    }
    return { emitted, skipped };
  }

  private async checkNewExpertiseHelper(args: { tenantId: string }): Promise<number> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000);
    const recentTraits = await this.prisma.helpfulnessTrait.findMany({
      where: {
        tenantId: args.tenantId,
        status: 'active',
        lastObservedAt: { gte: sevenDaysAgo },
        topicHint: { not: null },
        traitType: {
          in: [
            'help_provided',
            'proactive_hint',
            'mentoring',
            'emotional_support',
            'constructive_feedback',
          ],
        },
      },
      select: { helperUserId: true, topicHint: true },
      take: 500,
    });
    if (recentTraits.length === 0) return 0;

    const byHelper = new Map<string, Set<string>>();
    for (const t of recentTraits) {
      if (!t.topicHint) continue;
      const key = t.topicHint.toLowerCase().trim();
      if (!key) continue;
      const set = byHelper.get(t.helperUserId) ?? new Set<string>();
      set.add(key);
      byHelper.set(t.helperUserId, set);
    }

    let emitted = 0;
    for (const [userId, newTopics] of byHelper.entries()) {
      const profile = await this.prisma.socialContributionProfile.findUnique({
        where: {
          tenantId_userId: { tenantId: args.tenantId, userId },
        },
        select: { expertiseTopics: true },
      });
      const oldSet = new Set((profile?.expertiseTopics ?? []).map((t) => t.toLowerCase()));
      const trulyNew = [...newTopics].filter((t) => !oldSet.has(t));
      if (trulyNew.length === 0) continue;

      const helperName = await this.resolveUserDisplayName({
        tenantId: args.tenantId,
        userId,
      });
      const topic = trulyNew[0]!;
      const ok = await this.emit({
        tenantId: args.tenantId,
        reason: 'helpfulness.new_expertise_helper_detected',
        message: `У ${helperName} появилась новая тема экспертизы: «${topic}». Подписаться на его комментарии?`,
        recipientCandidates: await this.findRecipientsForUser({
          tenantId: args.tenantId,
          userId,
        }),
        priorityHint: 0.4,
      });
      if (ok) emitted += 1;
    }
    return emitted;
  }

  private async checkUnrecognizedHighContributor(args: { tenantId: string }): Promise<number> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400 * 1000);
    const grouped = await this.prisma.$queryRaw<Array<{ helperUserId: string; cnt: bigint }>>`
      SELECT "helperUserId", COUNT(*)::bigint AS cnt
      FROM "HelpfulnessTrait"
      WHERE "tenantId" = ${args.tenantId}
        AND "status" = 'active'
        AND "lastObservedAt" >= ${thirtyDaysAgo}
        AND "traitType" IN (
          'help_provided',
          'proactive_hint',
          'mentoring',
          'emotional_support',
          'constructive_feedback'
        )
      GROUP BY "helperUserId"
      HAVING COUNT(*) >= 20
      LIMIT 100
    `;
    if (grouped.length === 0) return 0;

    let emitted = 0;
    for (const g of grouped) {
      const recogs = await this.prisma.recognition.count({
        where: {
          tenantId: args.tenantId,
          toUserId: g.helperUserId,
          createdAt: { gte: thirtyDaysAgo },
        },
      });
      if (recogs > 0) continue;
      const helperName = await this.resolveUserDisplayName({
        tenantId: args.tenantId,
        userId: g.helperUserId,
      });
      const ok = await this.emit({
        tenantId: args.tenantId,
        reason: 'helpfulness.unrecognized_high_contributor',
        message: `${helperName} был очень активным помощником за последние 30 дней (${Number(g.cnt)} случаев помощи). Может, сказать ему спасибо лично?`,
        recipientCandidates: await this.findRecipientsForUser({
          tenantId: args.tenantId,
          userId: g.helperUserId,
        }),
        priorityHint: 0.7,
      });
      if (ok) emitted += 1;
    }
    return emitted;
  }

  private async checkMentorEmerging(args: { tenantId: string }): Promise<number> {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400 * 1000);
    const grouped = await this.prisma.$queryRaw<
      Array<{ helperUserId: string; topicHint: string | null; cnt: bigint }>
    >`
      SELECT "helperUserId", "topicHint", COUNT(*)::bigint AS cnt
      FROM "HelpfulnessTrait"
      WHERE "tenantId" = ${args.tenantId}
        AND "status" = 'active'
        AND "traitType" = 'mentoring'
        AND "lastObservedAt" >= ${fourteenDaysAgo}
      GROUP BY "helperUserId", "topicHint"
      HAVING COUNT(*) >= 5
      LIMIT 100
    `;
    if (grouped.length === 0) return 0;

    let emitted = 0;
    for (const g of grouped) {
      const helperName = await this.resolveUserDisplayName({
        tenantId: args.tenantId,
        userId: g.helperUserId,
      });
      const topic = g.topicHint ?? 'своей теме';
      const ok = await this.emit({
        tenantId: args.tenantId,
        reason: 'helpfulness.mentor_emerging',
        message: `${helperName} превращается в ментора по теме «${topic}» (${Number(g.cnt)} обучающих ситуаций за 2 недели). Рассмотрите как формального обучателя.`,
        recipientCandidates: await this.findRecipientsForUser({
          tenantId: args.tenantId,
          userId: g.helperUserId,
        }),
        priorityHint: 0.5,
      });
      if (ok) emitted += 1;
    }
    return emitted;
  }

  private async checkQuestionChainUnanswered(args: { tenantId: string }): Promise<number> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000);

    const grouped = await this.prisma.$queryRaw<
      Array<{ recipientUserId: string | null; cnt: bigint }>
    >`
      SELECT "recipientUserId", COUNT(*)::bigint AS cnt
      FROM "HelpfulnessTrait"
      WHERE "tenantId" = ${args.tenantId}
        AND "status" = 'active'
        AND "traitType" = 'question_unanswered'
        AND "lastObservedAt" >= ${sevenDaysAgo}
        AND "recipientUserId" IS NOT NULL
      GROUP BY "recipientUserId"
      HAVING COUNT(*) >= 3
      LIMIT 50
    `;
    if (grouped.length === 0) return 0;

    let emitted = 0;
    for (const g of grouped) {
      const targetUserId = g.recipientUserId;
      if (!targetUserId) continue;
      const targetName = await this.resolveUserDisplayName({
        tenantId: args.tenantId,
        userId: targetUserId,
      });

      const adminRecipients = await this.findAdminAndManagerRecipients({
        tenantId: args.tenantId,
        targetUserId,
      });
      if (adminRecipients.length === 0) continue;

      const ok = await this.emit({
        tenantId: args.tenantId,
        reason: 'helpfulness.question_chain_unanswered',
        message: `${targetName} оставлены ${Number(g.cnt)} вопросов без ответа за неделю. Проверьте контакт — возможно, человек заблокирован в работе.`,
        recipientCandidates: adminRecipients,
        priorityHint: 0.7,
      });
      if (ok) emitted += 1;
    }
    return emitted;
  }

  private async emit(args: {
    tenantId: string;
    reason: string;
    message: string;
    recipientCandidates: readonly string[];
    priorityHint?: number;
  }): Promise<boolean> {
    if (!this.probeService) {
      this.logger.debug(
        { reason: args.reason },
        'specialist-3-8.probe: ProbeService недоступен — skip',
      );
      return false;
    }
    if (args.recipientCandidates.length === 0) return false;
    const res = await this.probeService.suggest({
      tenantId: args.tenantId,
      emittedByService: Specialist38ProbeService.SPECIALIST_NAME,
      reason: args.reason,
      payload: {
        message: args.message,
        suggestedActions: ['Отметить', 'Скрыть'],
      },
      recipientCandidates: args.recipientCandidates,
      priorityHint: args.priorityHint ?? 0.4,
      dataClass: 'internal',
    });
    return 'ok' in res && res.ok;
  }

  private async findRecipientsForUser(args: {
    tenantId: string;
    userId: string;
  }): Promise<string[]> {
    return this.findAdminAndManagerRecipients(args);
  }

  private async findAdminAndManagerRecipients(args: {
    tenantId: string;
    targetUserId?: string;
    userId?: string;
  }): Promise<string[]> {
    const userId = args.targetUserId ?? args.userId;
    const recipients = new Set<string>();

    try {
      const memberships = await this.prisma.membership.findMany({
        where: {
          orgId: args.tenantId,
          role: { in: ['owner', 'admin'] },
        },
        select: { userId: true },
        take: 5,
      });
      for (const m of memberships) {
        if (m.userId) recipients.add(m.userId);
      }
    } catch (err) {
      this.logger.debug(
        { err: err instanceof Error ? err.message : String(err) },
        'specialist-3-8.probe.findAdmins: ошибка — пропускаю',
      );
    }

    if (userId) recipients.delete(userId);
    return [...recipients];
  }

  private async resolveUserDisplayName(args: {
    tenantId: string;
    userId: string;
  }): Promise<string> {
    try {
      const person = await this.prisma.person.findFirst({
        where: {
          tenantId: args.tenantId,
          userId: args.userId,
          deletedAt: null,
        },
        select: { name: true },
      });
      return person?.name ?? 'коллега';
    } catch {
      return 'коллега';
    }
  }
}
