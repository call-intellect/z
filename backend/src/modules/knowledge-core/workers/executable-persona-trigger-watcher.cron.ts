import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ExecutablePersonaVersioningService } from '../services/executable-persona-versioning.service';

/**
 * SBA γ-1 доделки + Фаза 5 «clone reliability hardening» —
 * ExecutablePersonaTriggerWatcherCron.
 *
 * Раз в 2 часа (`0 *\/2 * * *`) проходит по active SkillProfile'ям Org и
 * проверяет триггеры для внеочередного rebuild'а ExecutablePersona:
 *
 *   1. **critical** — если с момента `lastSnapshotAt` появился SkillTrait с
 *      `status='misleading'` И `misleadingFlaggedAt > lastSnapshotAt` И
 *      severity='critical' (severity хранится в `misleadingReason`
 *      JSON-сериализованным префиксом `[severity=critical]`).
 *   2. **trait_delta** — если за последние 24 часа (`createdAt > now-24h`)
 *      появилось ≥ `cfg.skill.personaRebuildTraitDeltaThreshold` (default 2)
 *      новых или замещённых active SkillTrait. Это пересечение с
 *      `createdAt > lastSnapshotAt` — учитываются только traits, которые
 *      ещё не вошли в активный snapshot.
 *   3. **max_age** — если возраст активного snapshot ≥
 *      `cfg.skill.personaRebuildMaxAgeHours` (default 48) — rebuild
 *      ставится даже без новых черт.
 *
 * Запуск rebuild'а — через `ExecutablePersonaVersioningService.triggerRebuild`,
 * который применяет Redis-SETNX замок per profile, чтобы не дёргать одну
 * persona несколько раз. Метрики: `persona_rebuild_triggered_total{reason}`
 * (counter, reason ∈ `trait_delta` | `max_age`).
 *
 * Cron disabled-by-tunable: если cfg.persona.scheduledRebuildEnabled = false,
 * этот cron всё равно работает — он про trigger-based, а не про weekly snapshot.
 */
@Injectable()
export class ExecutablePersonaTriggerWatcherCron {
  private readonly logger = new Logger(ExecutablePersonaTriggerWatcherCron.name);
  private static readonly MAX_PROFILES_PER_SWEEP = 500;
  private static readonly TRAIT_DELTA_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(ExecutablePersonaVersioningService)
    private readonly versioning: ExecutablePersonaVersioningService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 */2 * * *')
  async sweep(): Promise<void> {
    try {
      const summary = await this.runOnce();
      if (
        summary.triggeredTraitDelta > 0 ||
        summary.triggeredMaxAge > 0 ||
        summary.triggeredCritical > 0 ||
        summary.skippedLocked > 0
      ) {
        this.logger.log(summary, 'executable-persona-trigger-watcher: проход завершён');
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
    triggeredTraitDelta: number;
    triggeredMaxAge: number;
    triggeredCritical: number;
    skippedLocked: number;
    skippedNoSnapshotYet: number;
    skippedNoNewActivity: number;
  }> {
    const traitDeltaThreshold = this.cfg.skill.personaRebuildTraitDeltaThreshold;
    const maxAgeHours = this.cfg.skill.personaRebuildMaxAgeHours;
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
    const now = Date.now();
    const windowStart = new Date(now - ExecutablePersonaTriggerWatcherCron.TRAIT_DELTA_WINDOW_MS);

    let triggeredTraitDelta = 0;
    let triggeredMaxAge = 0;
    let triggeredCritical = 0;
    let skippedLocked = 0;
    let skippedNoSnapshotYet = 0;
    let skippedNoNewActivity = 0;
    let profilesScanned = 0;

    // Б14: тот же orderBy «самые несвежие первыми» (lastBuildAt asc nulls first)
    //      + курсор по всему хвосту, чтобы staleness-проверка доходила до всех
    //      профилей, а не только до первых MAX по scan-order.
    let profileCursor: string | undefined;
    for (;;) {
      const profiles = await this.prisma.skillProfile.findMany({
        where: { status: 'active' },
        select: { id: true, tenantId: true },
        orderBy: [{ lastBuildAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
        take: ExecutablePersonaTriggerWatcherCron.MAX_PROFILES_PER_SWEEP,
        ...(profileCursor ? { cursor: { id: profileCursor }, skip: 1 } : {}),
      });
      if (profiles.length === 0) break;
      profilesScanned += profiles.length;

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

          // 1. Critical: ищем mark_as_misleading 'critical' с момента last snapshot.
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

          // 2. trait_delta: ≥ threshold новых active traits за последние 24 часа,
          //    которые ещё не вошли в активный snapshot.
          const traitDeltaCutoff =
            windowStart > latest.snapshotAt ? windowStart : latest.snapshotAt;
          const newTraitsCount = await this.prisma.skillTrait.count({
            where: {
              profileId: profile.id,
              status: 'active',
              createdAt: { gt: traitDeltaCutoff },
            },
          });
          if (newTraitsCount >= traitDeltaThreshold) {
            const triggerEvent = await this.prisma.skillTrait.findFirst({
              where: {
                profileId: profile.id,
                status: 'active',
                createdAt: { gt: traitDeltaCutoff },
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
              triggeredTraitDelta++;
              this.metrics.incPersonaRebuildTriggered({ reason: 'trait_delta' });
            } else if (result.reason === 'locked') {
              skippedLocked++;
            }
            continue;
          }

          // 3. max_age: возраст активного snapshot превысил порог.
          const ageMs = now - latest.snapshotAt.getTime();
          if (ageMs >= maxAgeMs) {
            const result = await this.versioning.triggerRebuild({
              profileId: profile.id,
              reason: 'threshold',
              triggerEventAt: latest.snapshotAt,
            });
            if (result.built) {
              triggeredMaxAge++;
              this.metrics.incPersonaRebuildTriggered({ reason: 'max_age' });
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
      if (profiles.length < ExecutablePersonaTriggerWatcherCron.MAX_PROFILES_PER_SWEEP) {
        break;
      }
      profileCursor = profiles[profiles.length - 1]!.id;
    }

    return {
      profilesScanned,
      triggeredTraitDelta,
      triggeredMaxAge,
      triggeredCritical,
      skippedLocked,
      skippedNoSnapshotYet,
      skippedNoNewActivity,
    };
  }
}
