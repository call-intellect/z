import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';

/**
 * SBA γ-1 — SkillManagerDigestCron.
 *
 * Раз в неделю (default '0 9 * * MON') обходит всех direct manager'ов (Person
 * с Membership.role='manager') и считает, сколько новых SkillTrait'ов появилось
 * у их подчинённых (Person.primaryDepartmentId совпадает) за прошлую неделю.
 * Если > 0 — отправляет уведомление через ConversationalService с eventType
 * 'system.message' и actionUrl на curation page с фильтром skill_misleading_candidates.
 *
 * NB: `@Cron` принимает только литерал; cfg.skill.managerDigestCron используется
 * лишь для документации (схема ENV).
 */
@Injectable()
export class SkillManagerDigestCron {
  private readonly logger = new Logger(SkillManagerDigestCron.name);
  private static readonly WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  private static readonly MAX_MANAGERS_PER_SWEEP = 500;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 9 * * MON')
  async sweep(): Promise<void> {
    try {
      const summary = await this.runOnce();
      this.logger.log(
        summary,
        'skill-manager-digest.cron: проход завершён',
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'skill-manager-digest.cron: непойманная ошибка',
      );
    }
  }

  /** Public — для возможного админ-эндпоинта / ручного запуска. */
  async runOnce(): Promise<{
    managersScanned: number;
    digestsSent: number;
  }> {
    const since = new Date(Date.now() - SkillManagerDigestCron.WEEK_MS);

    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });

    let managersScanned = 0;
    let digestsSent = 0;

    for (const org of orgs) {
      // Direct managers (Membership.role='manager').
      const managerMemberships = await this.prisma.membership.findMany({
        where: { orgId: org.id, role: 'manager' },
        select: {
          userId: true,
          personId: true,
        },
        take: SkillManagerDigestCron.MAX_MANAGERS_PER_SWEEP,
      });
      for (const m of managerMemberships) {
        if (!m.personId) continue;
        managersScanned++;
        const manager = await this.prisma.person.findUnique({
          where: { id: m.personId },
          select: { primaryDepartmentId: true, name: true },
        });
        if (!manager?.primaryDepartmentId) continue;

        // Subordinates — employee в том же отделе.
        const subordinates = await this.prisma.person.findMany({
          where: {
            tenantId: org.id,
            primaryDepartmentId: manager.primaryDepartmentId,
            relationship: 'employee',
            deletedAt: null,
            // Исключаем самого менеджера.
            id: { not: m.personId },
          },
          select: { id: true },
        });
        if (subordinates.length === 0) continue;

        const subordinateIds = subordinates.map((s) => s.id);
        const profiles = await this.prisma.skillProfile.findMany({
          where: {
            tenantId: org.id,
            personId: { in: subordinateIds },
            status: 'active',
          },
          select: { id: true },
        });
        if (profiles.length === 0) continue;

        const newTraitsCount = await this.prisma.skillTrait.count({
          where: {
            profileId: { in: profiles.map((p) => p.id) },
            status: 'active',
            createdAt: { gte: since },
          },
        });
        if (newTraitsCount === 0) continue;

        try {
          await this.conversational.sendNotification({
            tenantId: org.id,
            recipientUserId: m.userId,
            eventType: 'system.message',
            payload: {
              title: 'Новые черты в навыковых профилях команды',
              body: `За прошлую неделю в навыковых профилях твоих подчинённых появилось ${newTraitsCount} новых черт. Просмотри и пометь подозрительные.`,
              severity: 'info',
              actionUrl: '/curation?filter=skill_misleading_candidates',
            },
            dataClass: 'internal',
          });
          digestsSent++;
        } catch (err) {
          this.logger.warn(
            {
              orgId: org.id,
              managerUserId: m.userId,
              err: err instanceof Error ? err.message : String(err),
            },
            'skill-manager-digest.cron: sendNotification упал — skip',
          );
        }
      }
    }

    return { managersScanned, digestsSent };
  }
}
