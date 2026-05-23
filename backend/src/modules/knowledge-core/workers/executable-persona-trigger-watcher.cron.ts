import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ExecutablePersonaVersioningService } from '../services/executable-persona-versioning.service';

/**
 * SBA γ-1 доделки — ExecutablePersonaTriggerWatcherCron.
 *
 * Каждые 15 минут (`*\/15 * * * *`) проходит по active SkillProfile'ям и
 * проверяет два класса триггеров для внеочередного rebuild'а ExecutablePersona:
 *
 *   1. **threshold** — если с момента `lastSnapshotAt` появилось ≥
 *      `EXECUTABLE_PERSONA_THRESHOLD_TRAITS_COUNT` (default 3) новых active
 *      `SkillTrait` (по `createdAt > lastSnapshotAt`).
 *   2. **critical** — если с момента `lastSnapshotAt` появилось ≥1 SkillTrait
 *      с `status='misleading'` И `misleadingFlaggedAt > lastSnapshotAt` И
 *      severity='critical' (severity хранится в `misleadingReason`
 *      JSON-сериализованным префиксом `[severity=critical]` — упрощённо для γ-1).
 *
 * Запуск rebuild'а — через `ExecutablePersonaVersioningService.triggerRebuild`,
 * который применяет Redis-SETNX замок min N минут (по умолчанию 60), чтобы
 * не дёргать одну persona несколько раз.
 *
 * Cron disabled-by-tunable: если cfg.persona.scheduledRebuildEnabled = false,
 * этот cron всё равно работает — он про trigger-based, а не про weekly snapshot.
 */
@Injectable()
export class ExecutablePersonaTriggerWatcherCron {
  private readonly logger = new Logger(
    ExecutablePersonaTriggerWatcherCron.name,
  );
  private static readonly MAX_PROFILES_PER_SWEEP = 500;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(ExecutablePersonaVersioningService)
    private readonly versioning: ExecutablePersonaVersioningService,
  ) {}

  @Cron('*/15 * * * *')
  async sweep(): Promise<void> {
    try {
      const summary = await this.runOnce();
      if (
        summary.triggeredThreshold > 0 ||
        summary.triggeredCritical > 0 ||
        summary.skippedLocked > 0
      ) {
        this.logger.log(
          summary,
          'executable-persona-trigger-watcher: проход завершён',
        );
      } else {
        this.logger.debug(
          summary,
          'executable-persona-trigger-watcher: проход завершён (без триггеров)',
        );
      }
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'executable-persona-trigger-watcher: непойманная ошибка',
      );
    }
  }

  /** Public — для возможного админ-эндпоинта / ручного запуска. */
  async runOnce(): Promise<{
    profilesScanned: number;
    triggeredThreshold: number;
    triggeredCritical: number;
    skippedLocked: number;
    skippedNoSnapshotYet: number;
    skippedNoNewActivity: number;
  }> {
    const threshold = this.cfg.persona.thresholdTraitsCount;

    const profiles = await this.prisma.skillProfile.findMany({
      where: { status: 'active' },
      select: { id: true, tenantId: true },
      take: ExecutablePersonaTriggerWatcherCron.MAX_PROFILES_PER_SWEEP,
    });

    let triggeredThreshold = 0;
    let triggeredCritical = 0;
    let skippedLocked = 0;
    let skippedNoSnapshotYet = 0;
    let skippedNoNewActivity = 0;

    for (const profile of profiles) {
      try {
        // Найти последний snapshot (active или superseded — нужен max version).
        const latest = await this.prisma.executablePersona.findFirst({
          where: { profileId: profile.id, scope: 'person' },
          orderBy: { snapshotAt: 'desc' },
          select: { snapshotAt: true },
        });
        if (!latest) {
          // Ещё не было ни одного snapshot — weekly cron его создаст, не дёргаем сейчас.
          skippedNoSnapshotYet++;
          continue;
        }

        // 2. Critical: ищем mark_as_misleading 'critical' с момента last snapshot.
        const criticalMisleading = await this.prisma.skillTrait.findFirst({
          where: {
            profileId: profile.id,
            status: 'misleading',
            misleadingFlaggedAt: { gt: latest.snapshotAt },
            misleadingReason: { contains: '[severity=critical]' },
          },
          select: { id: true, misleadingFlaggedAt: true },
          orderBy: { misleadingFlaggedAt: 'asc' },
        });
        if (criticalMisleading) {
          const result = await this.versioning.triggerRebuild({
            profileId: profile.id,
            reason: 'critical',
            triggerEventAt: criticalMisleading.misleadingFlaggedAt,
          });
          if (result.built) {
            triggeredCritical++;
          } else if (result.reason === 'locked') {
            skippedLocked++;
          }
          continue;
        }

        // 3. Threshold: ≥ threshold новых active traits.
        const newTraitsCount = await this.prisma.skillTrait.count({
          where: {
            profileId: profile.id,
            status: 'active',
            createdAt: { gt: latest.snapshotAt },
          },
        });
        if (newTraitsCount >= threshold) {
          // triggerEventAt — момент появления N-го trait'а (приближённо: max
          // createdAt среди новых).
          const triggerEvent = await this.prisma.skillTrait.findFirst({
            where: {
              profileId: profile.id,
              status: 'active',
              createdAt: { gt: latest.snapshotAt },
            },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
          });
          const result = await this.versioning.triggerRebuild({
            profileId: profile.id,
            reason: 'threshold',
            triggerEventAt: triggerEvent?.createdAt ?? null,
          });
          if (result.built) {
            triggeredThreshold++;
          } else if (result.reason === 'locked') {
            skippedLocked++;
          }
          continue;
        }

        skippedNoNewActivity++;
      } catch (err) {
        this.logger.warn(
          {
            profileId: profile.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'executable-persona-trigger-watcher: ошибка обработки профиля — skip',
        );
      }
    }

    return {
      profilesScanned: profiles.length,
      triggeredThreshold,
      triggeredCritical,
      skippedLocked,
      skippedNoSnapshotYet,
      skippedNoNewActivity,
    };
  }
}
