import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';

interface ProvidersAppearedEvent {
  names: string[];
  ts: number;
}

/**
 * Deferred-recovery для block-ingest: когда LlmRouter бросает
 * NoEligibleProviderError / LlmRouterDefaultChainInvalidError (провайдеров нет в
 * llm_providers или defaultChain не настроен) — BlockIngestWorker помечает
 * RawEvent как `deferred` (НЕ failed) и завершает job. Этот сервис слушает
 * событие `llm.providers.appeared` (эмитится из LlmRouter.refreshCache при
 * переходе knownProviderNames 0→>0) и re-енкеит все `deferred` RawEvent'ы
 * в очередь core.raw-events с уникальным suffix (jobId `raw_<id>_v2_providers-back-<ts>`).
 *
 * Идемпотентность: воркер skip'ает RawEvent'ы не в `processingStatus='received'`,
 * поэтому перед enqueue ставим `received`. Дубль-обработка защищена
 * (persistBlock, linkEntity, embedding — всё идемпотентно через unique constraints).
 */
@Injectable()
export class RawEventDeferredRecoveryService {
  private readonly logger = new Logger(RawEventDeferredRecoveryService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
  ) {}

  @OnEvent('llm.providers.appeared', { async: true })
  async handleProvidersAppeared(event: ProvidersAppearedEvent): Promise<void> {
    const deferred = await this.prisma.rawEvent.findMany({
      where: { processingStatus: 'deferred' },
      select: { id: true },
    });
    if (deferred.length === 0) {
      this.logger.debug(
        { triggeredBy: event.names.length },
        'RawEventDeferredRecovery: deferred RawEvent\'ов нет, выходим',
      );
      return;
    }
    this.logger.log(
      { count: deferred.length, newProviders: event.names.length },
      'RawEventDeferredRecovery: re-енкею отложенные RawEvent\'ы в core.raw-events',
    );
    const ts = Date.now();
    for (const ev of deferred) {
      try {
        await this.prisma.rawEvent.update({
          where: { id: ev.id },
          data: { processingStatus: 'received', processingError: null },
        });
        await this.coreQueue.enqueueRawReceived(ev.id, {
          suffix: `providers-back-${ts}`,
        });
      } catch (err) {
        this.logger.warn(
          { rawEventId: ev.id, err: err instanceof Error ? err.message : String(err) },
          'RawEventDeferredRecovery: не удалось re-енкнуть deferred RawEvent — пропуск',
        );
      }
    }
  }
}
