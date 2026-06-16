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
 *   - scope='role': клон-снимок ТЕКУЩЕГО носителя каждой Role (Раздел 7 — один
 *     носитель, без агрегации). buildForRole сам резолвит носителя и не оживляет
 *     frozen-версии бывших (Р6) — отдельной фильтрации в cron не требуется.
 *
 * Б14: выборка проходит ВЕСЬ хвост курсорной пагинацией (orderBy «самые
 *      несвежие первыми» + cursor), а не первые MAX по scan-order — иначе хвост
 *      профилей/ролей не пересобирается никогда. MAX_*_PER_SWEEP — размер
 *      страницы, не глобальный потолок.
 *
 * NB: `@Cron` принимает литерал; cfg.persona.buildCron — read-only при старте.
 */
@Injectable()
export class ExecutablePersonaBuildCron {
  private readonly logger = new Logger(ExecutablePersonaBuildCron.name);
  /** Б14 — размер страницы курсора (не глобальный потолок). */
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
    // SBA γ-1 доделки — мастер-тумблер weekly snapshot.
    if (!this.cfg.persona.scheduledRebuildEnabled) {
      this.logger.debug('executable-persona-build.cron: scheduledRebuildEnabled=false — skip');
      return;
    }
    try {
      const summary = await this.runOnce();
      this.logger.log(summary, 'executable-persona-build.cron: проход завершён');
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
    // Б15: предфильтр считает только layer='skill' (как гейтит buildForProfile),
    //      иначе профиль с value/process-чертами но 0 skill тратит вызов → null.
    // Б14: orderBy lastBuildAt asc nulls first (никогда-не-собранные и самые
    //      несвежие — первыми) + курсор по id, чтобы пройти ВЕСЬ хвост, а не
    //      первые MAX по scan-order (иначе хвост не пересобирается никогда).
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

    // 2. Role-level personas — клон ТЕКУЩЕГО носителя каждой Role (Раздел 7).
    // Б14: деттерминированный orderBy + курсор по всем ролям, чтобы хвост
    //      пересобирался (Role не имеет lastBuildAt — берём updatedAt asc как
    //      стабильный «самые давно не трогавшиеся первыми» прокси).
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
