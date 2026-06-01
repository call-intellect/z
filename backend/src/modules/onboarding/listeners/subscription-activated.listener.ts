/**
 * SubscriptionActivatedListener — слушает активацию подписки и ставит cleanup
 * демо-данных в очередь при первой оплате (FSM `DEMO → ACTIVE`).
 *
 * События `SUBSCRIPTION_ACTIVATED_PAID` / `_BONUS` эмитятся при ЛЮБОЙ
 * активации (DEMO→ACTIVE, EXPIRED→ACTIVE, SUSPENDED→ACTIVE, ...). Нам нужен
 * только первый переход из DEMO, поэтому фильтруем по `demoWorkspaceSeededAt`:
 *   - если демо никогда не лили (`null`) → выходим (нечего стирать);
 *   - иначе enqueue в `demo.cleanup`.
 * Это исключает ложные срабатывания при продлении/восстановлении подписки.
 *
 * Источник: plans/tz/2026-05-31-demo-auto-seed-and-cleanup.md §4.5.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  BillingEvent,
  type SubscriptionActivatedPayload,
} from '../../billing/events/billing.events';
import { DemoCleanupQueue } from '../workers/demo-cleanup.queue';

@Injectable()
export class SubscriptionActivatedListener {
  private readonly logger = new Logger(SubscriptionActivatedListener.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(DemoCleanupQueue) private readonly cleanupQueue: DemoCleanupQueue,
  ) {}

  @OnEvent(BillingEvent.SUBSCRIPTION_ACTIVATED_PAID)
  @OnEvent(BillingEvent.SUBSCRIPTION_ACTIVATED_BONUS)
  async onActivated(payload: SubscriptionActivatedPayload): Promise<void> {
    const org = await this.prisma.org.findUnique({
      where: { id: payload.tenantId },
      select: { demoWorkspaceSeededAt: true },
    });
    if (!org?.demoWorkspaceSeededAt) {
      // Демо не лили (или уже почистили) → cleanup не нужен.
      return;
    }

    try {
      const { jobId } = await this.cleanupQueue.enqueue({
        orgId: payload.tenantId,
        actorUserId: 'system:subscription-activated',
      });
      this.logger.log(
        { orgId: payload.tenantId, jobId, mode: payload.paymentMode },
        'subscription activated → enqueued demo-cleanup',
      );
    } catch (err) {
      // Очередь не должна валить активацию подписки (fire-and-forget).
      this.logger.error(
        {
          orgId: payload.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'не удалось поставить demo-cleanup в очередь',
      );
    }
  }
}
