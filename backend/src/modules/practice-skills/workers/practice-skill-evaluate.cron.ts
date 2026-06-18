import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { PracticeSkillEvaluatorService } from '../services/practice-skill-evaluator.service';

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
      this.logger.debug('practice-skill-evaluate.cron: START');
      const summary = await this.evaluator.runOnce();
      this.logger.debug(
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
        } catch {}
      }
      await this.refreshGauges();
    }
  }

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
        } catch {}
      }
    } catch (err) {
      this.logger.debug(
        `practice-skill-evaluate.cron.refreshGauges: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
