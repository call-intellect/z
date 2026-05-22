import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ExecutablePersonaBuildService } from '../services/executable-persona-build.service';

/**
 * SBA γ-1 — ExecutablePersonaBuildCron.
 *
 * Раз в неделю (default '0 6 * * SUN') собирает snapshots ExecutablePersona:
 *   - scope='person' для каждого active SkillProfile с >= PERSONA_MIN_TRAITS.
 *   - scope='role' для каждой Role с >= PERSONA_ROLE_AGG_MIN_PERSONS employee'ев.
 *
 * NB: `@Cron` принимает литерал; cfg.persona.buildCron — read-only при старте.
 */
@Injectable()
export class ExecutablePersonaBuildCron {
  private readonly logger = new Logger(ExecutablePersonaBuildCron.name);
  private static readonly MAX_PROFILES_PER_SWEEP = 500;
  private static readonly MAX_ROLES_PER_SWEEP = 200;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(ExecutablePersonaBuildService)
    private readonly builder: ExecutablePersonaBuildService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 6 * * SUN')
  async sweep(): Promise<void> {
    try {
      const summary = await this.runOnce();
      this.logger.log(
        summary,
        'executable-persona-build.cron: проход завершён',
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'executable-persona-build.cron: непойманная ошибка',
      );
    }
  }

  /** Public — для возможного админ-эндпоинта / ручного запуска. */
  async runOnce(): Promise<{
    profilesBuilt: number;
    profilesSkipped: number;
    rolesBuilt: number;
    rolesSkipped: number;
  }> {
    let profilesBuilt = 0;
    let profilesSkipped = 0;
    let rolesBuilt = 0;
    let rolesSkipped = 0;

    // 1. Person-level personas — все active SkillProfile с >= minTraits.
    const profileCandidates = await this.prisma.skillProfile.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        traits: {
          where: { status: 'active' },
          select: { id: true },
        },
      },
      take: ExecutablePersonaBuildCron.MAX_PROFILES_PER_SWEEP,
    });
    for (const profile of profileCandidates) {
      if (profile.traits.length < this.cfg.persona.minTraits) {
        profilesSkipped++;
        continue;
      }
      try {
        const persona = await this.builder.buildForProfile({
          profileId: profile.id,
        });
        if (persona) profilesBuilt++;
        else profilesSkipped++;
      } catch (err) {
        profilesSkipped++;
        this.logger.warn(
          {
            profileId: profile.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'executable-persona-build.cron: buildForProfile упал',
        );
      }
    }

    // 2. Role-level personas — Role с >= roleAggMinPersons.
    const roles = await this.prisma.role.findMany({
      where: { deletedAt: null },
      select: { id: true, tenantId: true },
      take: ExecutablePersonaBuildCron.MAX_ROLES_PER_SWEEP,
    });
    for (const role of roles) {
      try {
        const persona = await this.builder.buildForRole({
          tenantId: role.tenantId,
          roleId: role.id,
        });
        if (persona) rolesBuilt++;
        else rolesSkipped++;
      } catch (err) {
        rolesSkipped++;
        this.logger.warn(
          {
            roleId: role.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'executable-persona-build.cron: buildForRole упал',
        );
      }
    }

    // Обновить gauge активных персон.
    const activePersonByPerson = await this.prisma.executablePersona.count({
      where: { status: 'active', scope: 'person' },
    });
    const activePersonByRole = await this.prisma.executablePersona.count({
      where: { status: 'active', scope: 'role' },
    });
    this.metrics.setPersonaActiveTotal({
      scope: 'person',
      value: activePersonByPerson,
    });
    this.metrics.setPersonaActiveTotal({
      scope: 'role',
      value: activePersonByRole,
    });

    return { profilesBuilt, profilesSkipped, rolesBuilt, rolesSkipped };
  }
}
