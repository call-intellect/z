import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';
import { RegulationConsolidatorService } from '../services/regulation-consolidator.service';

type ConsolType = 'regulation' | 'process' | 'policy' | 'instruction';

@Injectable()
export class RegulationConsolidatorCronService {
  private readonly logger = new Logger(RegulationConsolidatorCronService.name);
  private static readonly TICK_LIMIT = 50;
  private static readonly TYPES: ConsolType[] = [
    'regulation',
    'process',
    'policy',
    'instruction',
  ];

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(RegulationConsolidatorService)
    private readonly consolidator: RegulationConsolidatorService,
  ) {}

  @Cron('*/30 * * * *')
  async sweep(): Promise<void> {
    try {
      const enqueued = await this.scanAndEnqueue();
      if (enqueued > 0) {
        this.logger.debug({ enqueued }, 'regulation-consolidator-cron: enqueue завершён');
      }
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'regulation-consolidator-cron: непойманная ошибка — повтор через 30 мин',
      );
    }
  }

  async scanAndEnqueue(): Promise<number> {
    let enabled: boolean;
    try {
      enabled = this.cfg.aiFeatures.regulationConsolidatorEnabled !== false;
    } catch {
      enabled = true;
    }
    if (!enabled) return 0;

    const orgs = await this.prisma.org.findMany({
      where: {
        deletedAt: null,
        memberships: {
          some: { role: { in: ['owner', 'admin'] } },
        },
      },
      select: { id: true },
    });
    if (orgs.length === 0) return 0;

    let enqueued = 0;
    for (const org of orgs) {
      if (enqueued >= RegulationConsolidatorCronService.TICK_LIMIT) break;
      for (const type of RegulationConsolidatorCronService.TYPES) {
        if (enqueued >= RegulationConsolidatorCronService.TICK_LIMIT) break;
        const remaining = RegulationConsolidatorCronService.TICK_LIMIT - enqueued;
        let ids: string[];
        try {
          ids = await this.consolidator.findCandidateCardIds(org.id, type, remaining, true);
        } catch (err) {
          this.logger.warn(
            {
              tenantId: org.id,
              type,
              err: err instanceof Error ? err.message : String(err),
            },
            'regulation-consolidator-cron: поиск кандидатов упал — пропускаем тип',
          );
          continue;
        }
        for (const cardId of ids) {
          if (enqueued >= RegulationConsolidatorCronService.TICK_LIMIT) break;
          try {
            await this.coreQueue.enqueueRegulationConsolidator(type, cardId);
            enqueued++;
          } catch (err) {
            this.logger.warn(
              {
                type,
                cardId,
                err: err instanceof Error ? err.message : String(err),
              },
              'regulation-consolidator-cron: enqueue упал — пропускаем',
            );
          }
        }
      }
    }
    return enqueued;
  }
}
