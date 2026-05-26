import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { Specialist38ProbeService } from '../services/specialist-3-8-probe.service';

/**
 * SBA Wave 2 — HelpfulnessProbeCron.
 *
 * Каждый день в 10:00 UTC проходит по всем активным tenant'ам и запускает 4
 * probe-trigger'а из Specialist38ProbeService:
 *   - helpfulness.new_expertise_helper_detected
 *   - helpfulness.unrecognized_high_contributor
 *   - helpfulness.mentor_emerging
 *   - helpfulness.question_chain_unanswered (PRIVATE — admin only)
 *
 * Best-effort: ProbeService встроил dedup + rate-limit + cold-start. Если у
 * tenant'а нет helper'ов — пройдёт без эмиссии.
 *
 * Запускается ПОСЛЕ SocialContributionProfileCron (05:00) и HelpfulnessSpotlightCron
 * (понедельник 09:00) — данные уже актуальные.
 */
@Injectable()
export class HelpfulnessProbeCron {
  private readonly logger = new Logger(HelpfulnessProbeCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Specialist38ProbeService)
    private readonly probes: Specialist38ProbeService,
  ) {}

  @Cron('0 10 * * *')
  async sweep(): Promise<void> {
    try {
      const summary = await this.runOnce();
      this.logger.log(summary, 'helpfulness-probe.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'helpfulness-probe.cron: непойманная ошибка',
      );
    }
  }

  /** Public — для ручного запуска / тестов. */
  async runOnce(): Promise<{ emittedTotal: number; orgsScanned: number }> {
    // Берём активные Org'и, у которых были helpfulness-traits за 30 дней.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400 * 1000);
    const tenants = await this.prisma.helpfulnessTrait.findMany({
      where: {
        status: 'active',
        lastObservedAt: { gte: thirtyDaysAgo },
      },
      select: { tenantId: true },
      distinct: ['tenantId'],
      take: 500,
    });

    let emittedTotal = 0;
    for (const t of tenants) {
      try {
        const res = await this.probes.runAllChecks({ tenantId: t.tenantId });
        emittedTotal += res.emitted;
      } catch (err) {
        this.logger.warn(
          {
            tenantId: t.tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'helpfulness-probe.cron: упало для tenant — skip',
        );
      }
    }
    return { emittedTotal, orgsScanned: tenants.length };
  }
}
