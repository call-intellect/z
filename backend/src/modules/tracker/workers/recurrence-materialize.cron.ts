import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { type IssueRecurrence } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import type { IssueTemplateConfig } from '../dto/recurrences/issue-template-config.types';
import { IssueMaterializeService } from '../services/issue-materialize.service';
import { IssueRecurrencesService } from '../services/issue-recurrences.service';

interface RunSummary {
  scanned: number;
  materialized: number;
  alreadyRanToday: number;
  dedupSkipped: number;
}

@Injectable()
export class RecurrenceMaterializeCron {
  private readonly logger = new Logger(RecurrenceMaterializeCron.name);

  private static readonly DEDUP_TTL_SECONDS = 86_400;
  private static readonly BATCH_LIMIT = 500;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(IssueMaterializeService)
    private readonly materializer: IssueMaterializeService,
  ) {}

  @Cron('0 6 * * *')
  async runScheduled(): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>(
      'tracker.recurrenceEnabled',
      'TRACKER_RECURRENCE_ENABLED',
      true,
    );
    if (!enabled) {
      this.logger.debug('recurrence-materialize: выключен — пропуск');
      return;
    }
    try {
      const summary = await this.run();
      this.logger.debug(summary, 'recurrence-materialize: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'recurrence-materialize: непойманная ошибка',
      );
    }
  }

  async run(now: Date = new Date()): Promise<RunSummary> {
    const due = await this.prisma.issueRecurrence.findMany({
      where: { enabled: true, nextRunAt: { lte: now } },
      orderBy: { nextRunAt: 'asc' },
      take: RecurrenceMaterializeCron.BATCH_LIMIT,
    });

    const summary: RunSummary = {
      scanned: due.length,
      materialized: 0,
      alreadyRanToday: 0,
      dedupSkipped: 0,
    };
    const todayKey = IssueRecurrencesService.dayKey(now);

    for (const rec of due) {
      try {
        const outcome = await this.processOne(rec, now, todayKey);
        if (outcome === 'materialized') summary.materialized += 1;
        else if (outcome === 'already_ran_today') summary.alreadyRanToday += 1;
        else if (outcome === 'dedup') summary.dedupSkipped += 1;
      } catch (err) {
        this.logger.warn(
          {
            tenantId: rec.tenantId,
            recurrenceId: rec.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'recurrence-materialize: ошибка обработки повторения — пропускаю',
        );
      }
    }

    return summary;
  }

  private async processOne(
    rec: IssueRecurrence,
    now: Date,
    todayKey: string,
  ): Promise<'materialized' | 'already_ran_today' | 'dedup'> {
    if (rec.lastRunAt && IssueRecurrencesService.dayKey(rec.lastRunAt) === todayKey) {
      await this.ensureFutureNextRun(rec, now);
      return 'already_ran_today';
    }

    const dedupOk = await this.dedupAcquire(rec.id, todayKey);
    if (!dedupOk) return 'dedup';

    const config = (rec.config ?? {}) as unknown as IssueTemplateConfig;
    await this.materializer.materialize({
      tenantId: rec.tenantId,
      projectId: rec.projectId,
      config,
      createdById: rec.createdById,
    });

    const rule = IssueRecurrencesService.parseRule(rec.rrule);
    let nextRunAt = IssueRecurrencesService.advance(rec.nextRunAt, rule);
    while (nextRunAt.getTime() <= now.getTime()) {
      nextRunAt = IssueRecurrencesService.advance(nextRunAt, rule);
    }

    await this.prisma.issueRecurrence.update({
      where: { id: rec.id },
      data: { lastRunAt: now, nextRunAt },
    });

    this.logger.log(
      {
        tenantId: rec.tenantId,
        recurrenceId: rec.id,
        projectId: rec.projectId,
        nextRunAt: nextRunAt.toISOString(),
      },
      'recurrence-materialize: создана задача из повторения',
    );
    return 'materialized';
  }

  private async ensureFutureNextRun(
    rec: IssueRecurrence,
    now: Date,
  ): Promise<void> {
    if (rec.nextRunAt.getTime() > now.getTime()) return;
    const rule = IssueRecurrencesService.parseRule(rec.rrule);
    let nextRunAt = IssueRecurrencesService.advance(rec.nextRunAt, rule);
    while (nextRunAt.getTime() <= now.getTime()) {
      nextRunAt = IssueRecurrencesService.advance(nextRunAt, rule);
    }
    await this.prisma.issueRecurrence.update({
      where: { id: rec.id },
      data: { nextRunAt },
    });
  }

  private async dedupAcquire(
    recurrenceId: string,
    dayKey: string,
  ): Promise<boolean> {
    const key = `recurrence_materialize:${recurrenceId}:${dayKey}`;
    try {
      const res = await this.redis.client.set(
        key,
        '1',
        'EX',
        RecurrenceMaterializeCron.DEDUP_TTL_SECONDS,
        'NX',
      );
      return res !== null;
    } catch (err) {
      this.logger.warn(
        {
          recurrenceId,
          dayKey,
          err: err instanceof Error ? err.message : String(err),
        },
        'recurrence-materialize: Redis SETNX упал — продолжаю без дедупа',
      );
      return true;
    }
  }
}
