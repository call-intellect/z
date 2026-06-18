import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';
import { RoleProfileService } from '../../role-profiles/services/role-profile.service';

@Injectable()
export class RoleProfileCron {
  private readonly logger = new Logger(RoleProfileCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(RoleProfileService) private readonly service: RoleProfileService,
  ) {}

  @Cron('0 */4 * * *')
  async sweepBuilds(): Promise<void> {
    try {
      const summary = await this.runForAllOrgs();
      this.logger.debug(summary, 'role-profile.cron.builds: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'role-profile.cron.builds: непойманная ошибка',
      );
    }
  }

  @Cron('0 * * * *')
  async sweepStale(): Promise<void> {
    try {
      const { marked } = await this.service.markStaleProfiles();
      if (marked > 0) {
        this.logger.debug({ marked }, 'role-profile.cron.stale: помечено профилей');
      }
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'role-profile.cron.stale: непойманная ошибка',
      );
    }
  }

  async runForAllOrgs(): Promise<{
    profilesScanned: number;
    profilesEnqueued: number;
    enqueueFailures: number;
  }> {
    const profiles = await this.prisma.roleProfile.findMany({
      where: { status: { in: ['forming', 'stale'] } },
      select: { tenantId: true, roleId: true, buildVersion: true },
    });

    let profilesEnqueued = 0;
    let enqueueFailures = 0;

    for (const p of profiles) {
      try {
        await this.coreQueue.enqueueRoleProfile({
          tenantId: p.tenantId,
          roleId: p.roleId,
          buildVersion: p.buildVersion,
          triggerReason: 'cron',
        });
        profilesEnqueued += 1;
      } catch (err) {
        enqueueFailures += 1;
        this.logger.warn(
          {
            tenantId: p.tenantId,
            roleId: p.roleId,
            err: err instanceof Error ? err.message : String(err),
          },
          'role-profile.cron.builds: ошибка enqueue — продолжаю',
        );
      }
    }

    return {
      profilesScanned: profiles.length,
      profilesEnqueued,
      enqueueFailures,
    };
  }
}
