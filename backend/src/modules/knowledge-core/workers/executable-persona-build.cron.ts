import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ExecutablePersonaBuildService } from '../services/executable-persona-build.service';

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
    if (!this.cfg.persona.scheduledRebuildEnabled) {
      this.logger.debug('executable-persona-build.cron: scheduledRebuildEnabled=false — skip');
      return;
    }
    try {
      const summary = await this.runOnce();
      this.logger.debug(summary, 'executable-persona-build.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'executable-persona-build.cron: непойманная ошибка',
      );
    }
  }

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

    let profileCursor: string | undefined;
    for (;;) {
      const profileCandidates = await this.prisma.skillProfile.findMany({
        where: { status: 'active' },
        select: {
          id: true,
          traits: {
            where: { status: 'active', layer: 'skill' },
            select: { id: true },
          },
        },
        orderBy: [{ lastBuildAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
        take: ExecutablePersonaBuildCron.MAX_PROFILES_PER_SWEEP,
        ...(profileCursor ? { cursor: { id: profileCursor }, skip: 1 } : {}),
      });
      if (profileCandidates.length === 0) break;
      for (const profile of profileCandidates) {
        if (profile.traits.length < this.cfg.persona.minTraits) {
          profilesSkipped++;
          continue;
        }
        try {
          const persona = await this.builder.buildForProfile({
            profileId: profile.id,
            triggerReason: 'scheduled',
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
      if (profileCandidates.length < ExecutablePersonaBuildCron.MAX_PROFILES_PER_SWEEP) {
        break;
      }
      profileCursor = profileCandidates[profileCandidates.length - 1]!.id;
    }

    let roleCursor: string | undefined;
    for (;;) {
      const roles = await this.prisma.role.findMany({
        where: { deletedAt: null },
        select: { id: true, tenantId: true },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: ExecutablePersonaBuildCron.MAX_ROLES_PER_SWEEP,
        ...(roleCursor ? { cursor: { id: roleCursor }, skip: 1 } : {}),
      });
      if (roles.length === 0) break;
      for (const role of roles) {
        try {
          const persona = await this.builder.buildForRole({
            tenantId: role.tenantId,
            roleId: role.id,
            triggerReason: 'scheduled',
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
      if (roles.length < ExecutablePersonaBuildCron.MAX_ROLES_PER_SWEEP) break;
      roleCursor = roles[roles.length - 1]!.id;
    }

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
