import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class SkillProfileRecalibrateCron {
  private readonly logger = new Logger(SkillProfileRecalibrateCron.name);
  private static readonly MAX_PROFILES_PER_SWEEP = 500;
  private static readonly PROFILE_PAGE_SIZE = 200;
  private static readonly MAX_PROFILE_PAGES = 50;

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
      this.logger.debug(summary, 'skill-profile-recalibrate.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'skill-profile-recalibrate.cron: непойманная ошибка',
      );
    }
  }

  async runOnce(): Promise<{
    profilesProcessed: number;
    traitsArchived: number;
    traitsDecayed: number;
    pendingArchived: number;
    activeProfiles: number;
  }> {
    const decayCutoff = new Date(
      Date.now() - this.cfg.skill.decayMonths * 30 * 24 * 60 * 60 * 1000,
    );
    const archiveCutoff = new Date(
      Date.now() - this.cfg.skill.archiveMonths * 30 * 24 * 60 * 60 * 1000,
    );

    let traitsArchived = 0;
    let traitsDecayed = 0;
    let pendingArchived = 0;
    let profilesProcessed = 0;

    let cursorId: string | null = null;
    const hardCap = SkillProfileRecalibrateCron.MAX_PROFILES_PER_SWEEP;
    for (
      let page = 0;
      page < SkillProfileRecalibrateCron.MAX_PROFILE_PAGES && profilesProcessed < hardCap;
      page++
    ) {
      const remaining = hardCap - profilesProcessed;
      const pageSize = Math.min(SkillProfileRecalibrateCron.PROFILE_PAGE_SIZE, remaining);
      const profiles: Array<{ id: string }> = await this.prisma.skillProfile.findMany({
        where: { status: 'active' },
        select: { id: true },
        orderBy: [{ lastBuildAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
        take: pageSize,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      });
      if (profiles.length === 0) break;
      cursorId = profiles[profiles.length - 1]!.id;

      for (const p of profiles) {
        profilesProcessed++;
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

          const pa = await this.prisma.skillTrait.updateMany({
            where: {
              profileId: p.id,
              status: 'pending_verification',
              createdAt: { lt: archiveCutoff },
            },
            data: { status: 'archived' },
          });
          pendingArchived += pa.count;

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

      if (profiles.length < pageSize) break;
    }

    const activeProfiles = await this.prisma.skillProfile.count({
      where: { status: 'active' },
    });
    this.metrics.setSkillProfilesActiveTotal(activeProfiles);

    return {
      profilesProcessed,
      traitsArchived,
      traitsDecayed,
      pendingArchived,
      activeProfiles,
    };
  }
}
