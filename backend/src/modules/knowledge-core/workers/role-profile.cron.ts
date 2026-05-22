import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';
import { RoleProfileService } from '../../role-profiles/services/role-profile.service';

/**
 * RoleProfileCron (Фаза 0d, см. plans/tz/2026-05-21-phase-0d-role-profile-agent.md §7).
 *
 * Два расписания:
 *   - `@Cron('0 *\/4 * * *')` — раз в 4 часа. Enqueue для всех RoleProfile со
 *     статусом `forming` или `stale`. Идемпотентность через jobId =
 *     `role_profile_<roleId>_v<buildVersion>` — если воркер не успел обработать
 *     предыдущий job, новый не создастся.
 *   - `@Cron('0 * * * *')` — раз в час. Маркирует профили как `stale`, если
 *     с lastBuildAt появились новые IdeaBlock'и с roleRelevant=true.
 */
@Injectable()
export class RoleProfileCron {
  private readonly logger = new Logger(RoleProfileCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(RoleProfileService) private readonly service: RoleProfileService,
  ) {}

  /**
   * Основной cron: раз в 4 часа enqueue для всех forming/stale RoleProfile.
   */
  @Cron('0 */4 * * *')
  async sweepBuilds(): Promise<void> {
    try {
      const summary = await this.runForAllOrgs();
      this.logger.log(summary, 'role-profile.cron.builds: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'role-profile.cron.builds: непойманная ошибка',
      );
    }
  }

  /**
   * Stale-detection: раз в час метит ready-профили как stale, если есть новые
   * IdeaBlock'и после lastBuildAt.
   */
  @Cron('0 * * * *')
  async sweepStale(): Promise<void> {
    try {
      const { marked } = await this.service.markStaleProfiles();
      if (marked > 0) {
        this.logger.log(
          { marked },
          'role-profile.cron.stale: помечено профилей',
        );
      }
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'role-profile.cron.stale: непойманная ошибка',
      );
    }
  }

  /**
   * Public для admin-эндпоинта (если потребуется ручной запуск).
   */
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
