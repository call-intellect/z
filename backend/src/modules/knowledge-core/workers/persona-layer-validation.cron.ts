import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { PersonaLayerValidationService } from '../services/persona-layer-validation.service';

@Injectable()
export class PersonaLayerValidationCron {
  private readonly logger = new Logger(PersonaLayerValidationCron.name);
  private static readonly LOCK_KEY = 'persona-layer-validation:lock';
  private static readonly LOCK_TTL_SEC = 60 * 60;
  private static readonly MAX_ROLES_PER_SWEEP = 10;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(PersonaLayerValidationService)
    private readonly validation: PersonaLayerValidationService,
  ) {}

  @Cron('0 7 * * SUN')
  async tick(): Promise<void> {
    if (!this.cfg.skill.personaLayerValidationEnabled) {
      this.logger.debug(
        'persona-layer-validation.cron: выключен (PERSONA_LAYER_VALIDATION_ENABLED=false), skip',
      );
      return;
    }
    let locked = false;
    try {
      const setRes = await this.redis.client.set(
        PersonaLayerValidationCron.LOCK_KEY,
        '1',
        'EX',
        PersonaLayerValidationCron.LOCK_TTL_SEC,
        'NX',
      );
      locked = setRes === 'OK';
      if (!locked) {
        this.logger.debug(
          'persona-layer-validation.cron: lock busy — другой pod выполняет проход, skip',
        );
        return;
      }
      this.logger.debug('persona-layer-validation.cron: START');
      const summary = await this.runOnce();
      this.logger.debug(
        `persona-layer-validation.cron: DONE orgs=${summary.orgsScanned} roles=${summary.rolesProcessed} cases=${summary.cases} skippedRoles=${summary.skippedRoles} failures=${summary.failures}`,
      );
    } catch (err) {
      this.logger.error(
        `persona-layer-validation.cron: непойманная ошибка: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      if (locked) {
        try {
          await this.redis.client.del(PersonaLayerValidationCron.LOCK_KEY);
        } catch {}
      }
    }
  }

  async runOnce(): Promise<{
    orgsScanned: number;
    rolesProcessed: number;
    cases: number;
    skippedRoles: number;
    failures: number;
  }> {
    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });

    let rolesProcessed = 0;
    let cases = 0;
    let skippedRoles = 0;
    let failures = 0;
    let budget = PersonaLayerValidationCron.MAX_ROLES_PER_SWEEP;

    for (const org of orgs) {
      if (budget <= 0) break;
      const personas = await this.prisma.executablePersona.findMany({
        where: {
          tenantId: org.id,
          scope: 'role',
          status: 'active',
          scopeRefId: { not: null },
        },
        select: { scopeRefId: true },
        take: budget,
      });
      const roleIds = [
        ...new Set(
          personas.map((p) => p.scopeRefId).filter((id): id is string => typeof id === 'string'),
        ),
      ];
      budget -= roleIds.length;
      for (const roleId of roleIds) {
        try {
          const res = await this.validation.validateRole({
            tenantId: org.id,
            roleId,
          });
          rolesProcessed++;
          cases += res.cases;
          if (res.skipped) skippedRoles++;
        } catch (err) {
          failures++;
          this.logger.warn(
            {
              roleId,
              err: err instanceof Error ? err.message : String(err),
            },
            'persona-layer-validation.cron: validateRole упал — пропускаю роль',
          );
        }
      }
    }

    return {
      orgsScanned: orgs.length,
      rolesProcessed,
      cases,
      skippedRoles,
      failures,
    };
  }
}
