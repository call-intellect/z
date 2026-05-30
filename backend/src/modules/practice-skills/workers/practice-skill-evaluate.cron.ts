import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { PracticeSkillEvaluatorService } from '../services/practice-skill-evaluator.service';

/**
 * Agents v2 Фаза C1 (2026-05-30) — PracticeSkillEvaluateCron.
 *
 * `@Cron('0 4 * * *')` — daily 04:00, ПОСЛЕ skill-trait-concept-normalizer (03:00)
 * и до момента, когда сотрудники начинают пользоваться клонами днём.
 *
 * 1. Global Redis SETNX lock (один pod выполняет проход) на 1 час.
 * 2. Вызывает `PracticeSkillEvaluatorService.runOnce()`.
 * 3. После прохода обновляет gauge `z_practice_skills_total{tenant_top,scope,status}`.
 */
@Injectable()
export class PracticeSkillEvaluateCron {
  private readonly logger = new Logger(PracticeSkillEvaluateCron.name);
  private static readonly LOCK_KEY = 'practice-skill-evaluate:lock';
  private static readonly LOCK_TTL_SEC = 60 * 60;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(PracticeSkillEvaluatorService)
    private readonly evaluator: PracticeSkillEvaluatorService,
  ) {}

  @Cron('0 4 * * *')
  async tick(): Promise<void> {
    let locked = false;
    try {
      const setRes = await this.redis.client.set(
        PracticeSkillEvaluateCron.LOCK_KEY,
        '1',
        'EX',
        PracticeSkillEvaluateCron.LOCK_TTL_SEC,
        'NX',
      );
      locked = setRes === 'OK';
      if (!locked) {
        this.logger.debug(
          'practice-skill-evaluate.cron: lock busy — другой pod выполняет проход, skip',
        );
        return;
      }
      this.logger.log('practice-skill-evaluate.cron: START');
      const summary = await this.evaluator.runOnce();
      this.logger.log(
        `practice-skill-evaluate.cron: DONE evaluated=${summary.skillsEvaluated} promoted=${summary.promoted} archived=${summary.archived} held=${summary.held}`,
      );
    } catch (err) {
      this.logger.error(
        `practice-skill-evaluate.cron: непойманная ошибка: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      if (locked) {
        try {
          await this.redis.client.del(PracticeSkillEvaluateCron.LOCK_KEY);
        } catch {
          /* TTL подчистит */
        }
      }
      // Snapshot gauge — даже если сам проход упал, snapshot важнее.
      await this.refreshGauges();
    }
  }

  /**
   * Обновляет `z_practice_skills_total{tenant_top,scope,status}` по группе.
   * Tenant_top label — это полный tenantId (так же, как в PRM-метриках —
   * cardinality на старте Фазы C1 невелика).
   */
  private async refreshGauges(): Promise<void> {
    try {
      const groups = await this.prisma.practiceSkill.groupBy({
        by: ['tenantId', 'scope', 'status'],
        _count: { _all: true },
      });
      for (const g of groups) {
        try {
          this.metrics.setPracticeSkillsTotal({
            tenantTop: g.tenantId,
            scope: g.scope,
            status: g.status,
            value: g._count._all,
          });
        } catch {
          /* observability */
        }
      }
    } catch (err) {
      this.logger.debug(
        `practice-skill-evaluate.cron.refreshGauges: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
