import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';

const ENABLED_KEY = 'knowledge.rawEventRecoveryEnabled';
const STALE_MINUTES_KEY = 'knowledge.rawEventRecoveryStaleMinutes';
const MAX_AGE_HOURS_KEY = 'knowledge.rawEventRecoveryMaxAgeHours';
const BATCH_LIMIT_KEY = 'knowledge.rawEventRecoveryBatchLimit';

const ENABLED_DEFAULT = true;
const STALE_MINUTES_DEFAULT = 30;
const MAX_AGE_HOURS_DEFAULT = 24;
const BATCH_LIMIT_DEFAULT = 200;

@Injectable()
export class RawEventRecoveryCron {
  private readonly logger = new Logger(RawEventRecoveryCron.name);
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Cron('*/15 * * * *', { name: 'raw-event-recovery' })
  async sweep(now: Date = new Date()): Promise<{
    reenqueued: number;
    deadLettered: number;
    scanned: number;
  }> {
    if (this.running) {
      this.logger.debug('raw-event-recovery.cron: prev run in progress, skip');
      return { reenqueued: 0, deadLettered: 0, scanned: 0 };
    }
    this.running = true;
    try {
      const enabled = await this.cfg.getDynamic<boolean>(ENABLED_KEY, undefined, ENABLED_DEFAULT);
      if (!enabled) {
        this.logger.debug('raw-event-recovery.cron: ENABLED=false, skip');
        return { reenqueued: 0, deadLettered: 0, scanned: 0 };
      }

      const [staleMinutes, maxAgeHours, batchLimit] = await Promise.all([
        this.cfg.getDynamic<number>(STALE_MINUTES_KEY, undefined, STALE_MINUTES_DEFAULT),
        this.cfg.getDynamic<number>(MAX_AGE_HOURS_KEY, undefined, MAX_AGE_HOURS_DEFAULT),
        this.cfg.getDynamic<number>(BATCH_LIMIT_KEY, undefined, BATCH_LIMIT_DEFAULT),
      ]);

      return await this.runOnce({ now, staleMinutes, maxAgeHours, batchLimit });
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'raw-event-recovery.cron: проход упал',
      );
      return { reenqueued: 0, deadLettered: 0, scanned: 0 };
    } finally {
      this.running = false;
    }
  }

  async runOnce(args: {
    now: Date;
    staleMinutes: number;
    maxAgeHours: number;
    batchLimit: number;
  }): Promise<{ reenqueued: number; deadLettered: number; scanned: number }> {
    const { now, staleMinutes, maxAgeHours, batchLimit } = args;
    const staleBefore = new Date(now.getTime() - staleMinutes * 60 * 1000);
    const maxAgeBefore = new Date(now.getTime() - maxAgeHours * 60 * 60 * 1000);

    const stuck = await this.prisma.rawEvent.findMany({
      where: {
        processingStatus: 'received',
        receivedAt: { lt: staleBefore },
      },
      select: { id: true, tenantId: true, receivedAt: true },
      orderBy: { receivedAt: 'asc' },
      take: batchLimit,
    });

    let reenqueued = 0;
    let deadLettered = 0;

    for (const ev of stuck) {
      if (ev.receivedAt < maxAgeBefore) {
        deadLettered++;
        this.metrics.incRawEventRecoveryDeadLettered();
        this.logger.error(
          {
            rawEventId: ev.id,
            tenantId: ev.tenantId,
            receivedAt: ev.receivedAt.toISOString(),
            maxAgeHours,
          },
          'raw-event-recovery.cron: DEAD-LETTER — RawEvent застрял в received дольше maxAge, требует оператора',
        );
        continue;
      }

      try {
        await this.coreQueue.enqueueRawReceived(ev.id, { suffix: 'recovery' });
        reenqueued++;
        this.metrics.incRawEventRecoveryReenqueued();
        this.logger.debug(
          { rawEventId: ev.id, tenantId: ev.tenantId },
          'raw-event-recovery.cron: застрявший RawEvent повторно поставлен в block-ingest',
        );
      } catch (err) {
        this.logger.warn(
          {
            rawEventId: ev.id,
            tenantId: ev.tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'raw-event-recovery.cron: реэнкьюй упал — продолжаю со следующим',
        );
      }
    }

    if (reenqueued > 0 || deadLettered > 0) {
      this.logger.debug(
        { scanned: stuck.length, reenqueued, deadLettered },
        'raw-event-recovery.cron: проход завершён',
      );
    }

    return { reenqueued, deadLettered, scanned: stuck.length };
  }
}
