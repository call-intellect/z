import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { RolePrincipleSynthesisService } from '../services/role-principle-synthesis.service';

@Injectable()
export class RolePrincipleSynthesisCron {
  private readonly logger = new Logger(RolePrincipleSynthesisCron.name);
  private static readonly LOCK_KEY = 'role-principle-synthesis:lock';
  private static readonly LOCK_TTL_SEC = 60 * 60;
  private static readonly MAX_ROLES_PER_SWEEP = 100;
  private static readonly PRE_LLM_SKIP_REASONS: ReadonlySet<string> = new Set([
    'role_not_found',
    'no_persons',
    'no_entities',
    'below_threshold',
    'no_groups',
  ]);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(RolePrincipleSynthesisService)
    private readonly synthesis: RolePrincipleSynthesisService,
  ) {}

  @Cron('30 5 * * *')
  async tick(): Promise<void> {
    if (!this.cfg.rolePrinciples.synthesisEnabled) {
      this.logger.debug(
        'role-principle-synthesis.cron: выключен (ROLE_PRINCIPLE_SYNTHESIS_ENABLED=false), skip',
      );
      return;
    }
    let locked = false;
    try {
      const setRes = await this.redis.client.set(
        RolePrincipleSynthesisCron.LOCK_KEY,
        '1',
        'EX',
        RolePrincipleSynthesisCron.LOCK_TTL_SEC,
        'NX',
      );
      locked = setRes === 'OK';
      if (!locked) {
        this.logger.debug(
          'role-principle-synthesis.cron: lock busy — другой pod выполняет проход, skip',
        );
        return;
      }
      this.logger.debug('role-principle-synthesis.cron: START');
      const summary = await this.runOnce();
      this.logger.debug(
        `role-principle-synthesis.cron: DONE orgs=${summary.orgsScanned} roles=${summary.rolesProcessed} created=${summary.created} merged=${summary.merged} skipped=${summary.skipped} failures=${summary.failures}`,
      );
    } catch (err) {
      this.logger.error(
        `role-principle-synthesis.cron: непойманная ошибка: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      if (locked) {
        try {
          await this.redis.client.del(RolePrincipleSynthesisCron.LOCK_KEY);
        } catch {}
      }
      await this.refreshGauge();
    }
  }

  async runOnce(): Promise<{
    orgsScanned: number;
    rolesProcessed: number;
    created: number;
    merged: number;
    skipped: number;
    failures: number;
  }> {
    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });

    let rolesProcessed = 0;
    let created = 0;
    let merged = 0;
    let skipped = 0;
    let failures = 0;
    let budget = RolePrincipleSynthesisCron.MAX_ROLES_PER_SWEEP;

    for (const org of orgs) {
      if (budget <= 0) break;
      const roles = await this.prisma.role.findMany({
        where: { tenantId: org.id, deletedAt: null },
        select: { id: true },
        take: RolePrincipleSynthesisCron.MAX_ROLES_PER_SWEEP,
      });
      for (const role of roles) {
        if (budget <= 0) break;
        try {
          const res = await this.synthesis.synthesizeForRole({
            tenantId: org.id,
            roleId: role.id,
          });
          rolesProcessed++;
          created += res.created;
          merged += res.merged;
          if (res.skipped) skipped++;
          const calledLlm =
            res.skipped === null ||
            !RolePrincipleSynthesisCron.PRE_LLM_SKIP_REASONS.has(res.skipped);
          if (calledLlm) budget--;
        } catch (err) {
          failures++;
          this.logger.warn(
            {
              roleId: role.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'role-principle-synthesis.cron: synthesizeForRole упал — пропускаю роль',
          );
        }
      }
    }

    return {
      orgsScanned: orgs.length,
      rolesProcessed,
      created,
      merged,
      skipped,
      failures,
    };
  }

  private async refreshGauge(): Promise<void> {
    try {
      const n = await this.prisma.rolePrinciple.count({
        where: { status: 'active' },
      });
      this.metrics.setRolePrinciplesActiveTotal(n);
    } catch (err) {
      this.logger.debug(
        `role-principle-synthesis.cron.refreshGauge: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
