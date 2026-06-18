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
  private readonly logger = new Logger(
    ExecutablePersonaTriggerWatcherCron.name,
  );
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
        summary.skippedLocked > 0 ||
        summary.skippedMaxAgeUnchanged > 0
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
    triggeredTraitDelta: number;
    triggeredMaxAge: number;
    triggeredCritical: number;
    skippedLocked: number;
    skippedNoSnapshotYet: number;
    skippedNoNewActivity: number;
    /** Б31 — max_age наступил, но вход (черты) не изменился → LLM НЕ дёргали. */
    skippedMaxAgeUnchanged: number;
  }> {
    const traitDeltaThreshold = this.cfg.skill.personaRebuildTraitDeltaThreshold;
    const maxAgeHours = this.cfg.skill.personaRebuildMaxAgeHours;
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
    const now = Date.now();
    const windowStart = new Date(
      now - ExecutablePersonaTriggerWatcherCron.TRAIT_DELTA_WINDOW_MS,
    );

    const profiles = await this.prisma.skillProfile.findMany({
      where: { status: 'active' },
      select: { id: true, tenantId: true },
      take: ExecutablePersonaTriggerWatcherCron.MAX_PROFILES_PER_SWEEP,
    });

    let triggeredTraitDelta = 0;
    let triggeredMaxAge = 0;
    let triggeredCritical = 0;
    let skippedLocked = 0;
    let skippedNoSnapshotYet = 0;
    let skippedNoNewActivity = 0;
    let skippedMaxAgeUnchanged = 0;

    for (const profile of profiles) {
      try {
        // Найти последний snapshot (active или superseded — нужен max version).
        // Б31 — также тянем includedTraitIds + status: для max_age-ветки нужен
        // набор черт АКТИВНОГО compile, чтобы не форсить дорогой LLM-rebuild,
        // если вход не изменился.
        const latest = await this.prisma.executablePersona.findFirst({
          where: { profileId: profile.id, scope: 'person' },
          orderBy: { snapshotAt: 'desc' },
          select: { snapshotAt: true, status: true, includedTraitIds: true },
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
          // Б31 — раньше max_age БЕЗУСЛОВНО форсил полный LLM-compile каждые
          // ~maxAgeHours (48ч) даже без единой новой черты — деньги/латентность
          // на ветер. Теперь: хэш входа (отсортированные active trait-id, что
          // builder включил бы СЕЙЧАС) сверяем с черт-набором последнего
          // active-compile (ExecutablePersona.includedTraitIds — уже в БД,
          // отдельного хранилища/Redis/миграции не нужно). Совпало → продлеваем
          // «свежесть» БЕЗ LLM-вызова (просто пропускаем; следующий проход
          // снова сверит). Расходимся → реальный rebuild как раньше.
          const inputUnchanged = await this.isMaxAgeInputUnchanged(
            profile.id,
            latest.status === 'active' ? latest.includedTraitIds : null,
          );
          if (inputUnchanged) {
            skippedMaxAgeUnchanged++;
            continue;
          }
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

    return {
      profilesScanned: profiles.length,
      triggeredTraitDelta,
      triggeredMaxAge,
      triggeredCritical,
      skippedLocked,
      skippedNoSnapshotYet,
      skippedNoNewActivity,
      skippedMaxAgeUnchanged,
    };
  }

  /**
   * Б31 — сравнивает набор черт, который builder включил БЫ в persona СЕЙЧАС,
   * с набором черт последнего active-compile (`includedTraitIds`). Возвращает
   * true, если входной набор не изменился (можно пропустить дорогой LLM-rebuild
   * по max_age). Сравнение по МНОЖЕСТВУ id (порядок не важен) через хэш
   * отсортированного списка.
   *
   * Если у профиля нет активного snapshot'а (`prevIncluded === null`) — считаем
   * вход «изменившимся» (false), чтобы rebuild всё-таки прошёл.
   */
  private async isMaxAgeInputUnchanged(
    profileId: string,
    prevIncluded: string[] | null,
  ): Promise<boolean> {
    if (prevIncluded === null) return false;
    const current = await this.computeCurrentInputTraitIds(profileId);
    // Пустой текущий вход (builder ничего не включит / профиль выродился) —
    // не блокируем rebuild, пусть штатная логика решит.
    if (current.length === 0) return false;
    return hashTraitIds(current) === hashTraitIds(prevIncluded);
  }

  /**
   * Б31 — зеркалит выборку `includedTraitIds` из
   * ExecutablePersonaBuildService.buildForProfile (person-scope): active
   * SkillTrait слоёв skill(top20) + value/motivation/process_marker(top5),
   * orderBy [confidence desc, observationCount desc]. Возвращает массив id
   * (мы сравниваем по множеству, поэтому точный порядок внутри слоёв не важен,
   * но take-границы воспроизводим, чтобы вход совпадал 1:1 с тем, что осело
   * бы в includedTraitIds при реальном compile).
   */
  private async computeCurrentInputTraitIds(
    profileId: string,
  ): Promise<string[]> {
    const orderBy = [
      { confidence: 'desc' as const },
      { observationCount: 'desc' as const },
    ];
    const [skill, value, motivation, processMarker] = await Promise.all([
      this.prisma.skillTrait.findMany({
        where: { profileId, status: 'active', layer: 'skill' },
        orderBy,
        take: 20,
        select: { id: true },
      }),
      this.prisma.skillTrait.findMany({
        where: { profileId, status: 'active', layer: 'value' },
        orderBy,
        take: 5,
        select: { id: true },
      }),
      this.prisma.skillTrait.findMany({
        where: { profileId, status: 'active', layer: 'motivation' },
        orderBy,
        take: 5,
        select: { id: true },
      }),
      this.prisma.skillTrait.findMany({
        where: { profileId, status: 'active', layer: 'process_marker' },
        orderBy,
        take: 5,
        select: { id: true },
      }),
    ]);
    return [
      ...skill.map((t) => t.id),
      ...value.map((t) => t.id),
      ...motivation.map((t) => t.id),
      ...processMarker.map((t) => t.id),
    ];
  }
}

/**
 * Б31 — устойчивый хэш набора trait-id по МНОЖЕСТВУ: dedupe + сортировка +
 * join. Одинаковый набор (в любом порядке, с дублями) → одинаковая строка.
 */
function hashTraitIds(ids: string[]): string {
  return Array.from(new Set(ids)).sort().join('|');
}
