import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * SBA γ-1 — SkillProfileRecalibrateCron.
 *
 * Раз в сутки (default '0 5 * * *') проходит все active SkillProfile и
 * применяет decay к traits:
 *   - traits с lastConfirmedAt < now - SKILL_DECAY_MONTHS → confidence↓
 *     (high → medium → low).
 *   - traits с lastConfirmedAt < now - SKILL_ARCHIVE_MONTHS → status='archived'.
 *
 * Также обновляет gauge skill_profiles_active_total + наблюдение
 * skill_traits_per_profile.
 *
 * NB: расписание читается из cfg.skill.recalibrateCron — но `@Cron` требует
 * литерала. Используется дефолтное `0 5 * * *`. Для runtime-настройки в
 * следующей фазе можно вынести в SchedulerRegistry.
 */
@Injectable()
export class SkillProfileRecalibrateCron {
  private readonly logger = new Logger(SkillProfileRecalibrateCron.name);
  private static readonly MAX_PROFILES_PER_SWEEP = 500;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 5 * * *')
  async sweep(): Promise<void> {
    try {
      const summary = await this.runOnce();
      this.logger.log(
        summary,
        'skill-profile-recalibrate.cron: проход завершён',
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'skill-profile-recalibrate.cron: непойманная ошибка',
      );
    }
  }

  /** Public — для возможного админ-эндпоинта / ручного запуска. */
  async runOnce(): Promise<{
    profilesProcessed: number;
    traitsArchived: number;
    traitsDecayed: number;
    activeProfiles: number;
  }> {
    const decayCutoff = new Date(
      Date.now() - this.cfg.skill.decayMonths * 30 * 24 * 60 * 60 * 1000,
    );
    const archiveCutoff = new Date(
      Date.now() - this.cfg.skill.archiveMonths * 30 * 24 * 60 * 60 * 1000,
    );

    const profiles = await this.prisma.skillProfile.findMany({
      where: { status: 'active' },
      select: { id: true },
      take: SkillProfileRecalibrateCron.MAX_PROFILES_PER_SWEEP,
    });

    let traitsArchived = 0;
    let traitsDecayed = 0;
    for (const p of profiles) {
      try {
        const a = await this.prisma.skillTrait.updateMany({
          where: {
            profileId: p.id,
            status: 'active',
            lastConfirmedAt: { lt: archiveCutoff },
          },
          data: { status: 'archived' },
        });
        traitsArchived += a.count;

        // Decay на ОДНУ ступень за проход.
        // порядок: medium→low ДО high→medium — иначе high упадёт в low за один
        // проход (свежеставший из high `medium` иначе попал бы во второй шаг).
        const d1 = await this.prisma.skillTrait.updateMany({
          where: {
            profileId: p.id,
            status: 'active',
            confidence: 'medium',
            lastConfirmedAt: { lt: decayCutoff },
          },
          data: { confidence: 'low' },
        });
        const d2 = await this.prisma.skillTrait.updateMany({
          where: {
            profileId: p.id,
            status: 'active',
            confidence: 'high',
            lastConfirmedAt: { lt: decayCutoff },
          },
          data: { confidence: 'medium' },
        });
        traitsDecayed += d1.count + d2.count;

        // Histogram observation — сколько активных traits в профиле.
        const activeCount = await this.prisma.skillTrait.count({
          where: { profileId: p.id, status: 'active' },
        });
        this.metrics.observeSkillTraitsPerProfile(activeCount);
      } catch (err) {
        this.logger.warn(
          {
            profileId: p.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'skill-profile-recalibrate.cron: ошибка обработки профиля — skip',
        );
      }
    }

    // Обновить gauge активных профилей.
    const activeProfiles = await this.prisma.skillProfile.count({
      where: { status: 'active' },
    });
    this.metrics.setSkillProfilesActiveTotal(activeProfiles);

    return {
      profilesProcessed: profiles.length,
      traitsArchived,
      traitsDecayed,
      activeProfiles,
    };
  }
}
