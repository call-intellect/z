import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { TypedConfigService } from '../../../common/config/typed-config.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  BillingEvent,
  type SubscriptionActivatedPayload,
} from '../../billing/events/billing.events';

@Injectable()
export class SubscriptionActivatedListener {
  private readonly logger = new Logger(SubscriptionActivatedListener.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @OnEvent(BillingEvent.SUBSCRIPTION_ACTIVATED_PAID)
  @OnEvent(BillingEvent.SUBSCRIPTION_ACTIVATED_BONUS)
  async onActivated(payload: SubscriptionActivatedPayload): Promise<void> {
    const demoOrgId = this.cfg.demo.referenceOrgId;
    if (!demoOrgId) {
      this.logger.debug(
        { orgId: payload.tenantId },
        'ZDEMO_ORG_ID не задана — пропуск detach demo_observer',
      );
      return;
    }
    if (payload.tenantId === demoOrgId) return;

    const activated = await this.prisma.org.findUnique({
      where: { id: payload.tenantId },
      select: { ownerId: true },
    });
    if (!activated) {
      this.logger.warn(
        { orgId: payload.tenantId },
        'subscription activated → Org не найдена, пропуск',
      );
      return;
    }

    const result = await this.prisma.membership.deleteMany({
      where: {
        userId: activated.ownerId,
        orgId: demoOrgId,
        role: 'demo_observer',
      },
    });

    this.logger.log(
      {
        orgId: payload.tenantId,
        ownerId: activated.ownerId,
        deleted: result.count,
        mode: payload.paymentMode,
      },
      'subscription activated → demo_observer membership detached from reference org',
    );
  }
}
