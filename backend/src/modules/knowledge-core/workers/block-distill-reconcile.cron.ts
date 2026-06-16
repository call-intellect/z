import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';
import { WorkerOrgGate } from '../../core-queue/worker-org-gate';

/**
 * Аудит-баг Б4 (high, класс K7) — реконсиляция застрявших draft-блоков.
 *
 * `block-ingest.worker` НАМЕРЕННО помечает `RawEvent.processingStatus='ingested'`
 * ПЕРЕД best-effort `enqueueBlockDistill` (enqueue после фиксации evidence —
 * чтобы дистилляция не распилила блок до записи свидетельств). Из-за этого при
 * краше / сбое Redis между `update(ingested)` и `enqueueBlockDistill` повторный
 * заход джоба делает ранний skip (`processingStatus !== 'received'`) и НИКОГДА
 * не доenqueue'ит distill → блок навсегда остаётся `status='draft'`, карточка
 * не рождается.
 *
 * Реордер «enqueue до ingested» НЕ годится (он сломал бы инвариант «distill
 * только после evidence»). Вместо этого — догоночный @Cron: раз в 30 минут по
 * каждой активной Org находит draft-блоки старше порога STALE_DRAFT_MS и
 * идемпотентно ре-enqueue'ит для них block-distill.
 *
 * Идемпотентность многослойная:
 *   - jobId-дедуп BullMQ (`block_distill_<blockId>`): пока distill-job висит в
 *     waiting/active/delayed, повторный enqueue его не дублирует.
 *   - сам block-distill.worker делает skip not-draft блоков — повторная попытка
 *     над уже распиленным блоком безвредна.
 *
 * Это READ-почти-only проход: никаких записей в граф, только публикация
 * distill-job'ов + структурный лог-summary.
 */
@Injectable()
export class BlockDistillReconcileCron {
  private readonly logger = new Logger(BlockDistillReconcileCron.name);
  private static readonly WORKER_NAME = 'block-distill-reconcile';
  /**
   * Порог «застрявшего черновика»: distill-debounce 30с + большой запас.
   * Блок, оставшийся draft дольше этого, почти наверняка не получил distill-job
   * (краш/сбой Redis между ingested и enqueue) → реконсиляция его добивает.
   * Операционный порог, НЕ owner-крутилка.
   */
  private static readonly STALE_DRAFT_MS = 10 * 60 * 1000; // 10 мин
  /** Разумный батч на Org за тик — чтобы не залить очередь разом. */
  private static readonly BATCH_PER_ORG = 500;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(WorkerOrgGate) private readonly gate: WorkerOrgGate,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async sweep(): Promise<void> {
    try {
      const summary = await this.runForAllOrgs();
      this.logger.log(summary, 'block-distill-reconcile: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'block-distill-reconcile: непойманная ошибка — повтор через 30 минут',
      );
    }
  }

  /** Вынесен публично для ручного запуска / тестов. */
  async runForAllOrgs(): Promise<{
    scannedOrgs: number;
    staleDraft: number;
    reEnqueued: number;
  }> {
    const orgs = await this.prisma.org.findMany({
      where: {
        deletedAt: null,
        memberships: {
          some: { role: { in: ['owner', 'admin'] } },
        },
      },
      select: { id: true },
    });

    const staleCutoff = new Date(
      Date.now() - BlockDistillReconcileCron.STALE_DRAFT_MS,
    );
    let staleDraft = 0;
    let reEnqueued = 0;

    for (const org of orgs) {
      // Org-Admin тумблер (kill-switch, ON по умолчанию): если воркер выключен
      // для Org — скипаем.
      try {
        await this.gate.checkOrThrow(
          org.id,
          BlockDistillReconcileCron.WORKER_NAME,
        );
      } catch {
        this.logger.debug(
          { tenantId: org.id },
          'block-distill-reconcile: gate disabled — skip Org',
        );
        continue;
      }

      try {
        const blocks = await this.prisma.ideaBlock.findMany({
          where: {
            tenantId: org.id,
            status: 'draft',
            createdAt: { lt: staleCutoff },
          },
          select: { id: true },
          take: BlockDistillReconcileCron.BATCH_PER_ORG,
          orderBy: { createdAt: 'asc' },
        });

        for (const block of blocks) {
          staleDraft += 1;
          // Идемпотентно: jobId-дедуп BullMQ + skip not-draft в distill-worker.
          // delayMs=0 — добиваем сразу, без 30с дебаунса (окно «соседних блоков»
          // давно закрылось — блок уже застрял).
          await this.coreQueue
            .enqueueBlockDistill(block.id, { delayMs: 0 })
            .then(() => {
              reEnqueued += 1;
            })
            .catch((err) => {
              this.logger.warn(
                {
                  tenantId: org.id,
                  blockId: block.id,
                  err: err instanceof Error ? err.message : String(err),
                },
                'block-distill-reconcile: enqueueBlockDistill упал — попробуем в следующий проход',
              );
            });
        }
      } catch (err) {
        this.logger.warn(
          {
            tenantId: org.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'block-distill-reconcile: ошибка на Org — продолжаю',
        );
      }
    }

    return { scannedOrgs: orgs.length, staleDraft, reEnqueued };
  }
}
