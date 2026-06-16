import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, type Subscription, type SubscriptionStatus } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { SubscriptionEventType } from '../billing.types';
import {
  BillingEvent,
  type SubscriptionExpiredPayload,
  type SubscriptionSeatsChangedPayload,
} from '../events/billing.events';

import { assertCanTransition } from './subscription-fsm';

export interface TransitionOptions {
  to: SubscriptionStatus;
  byUserId?: string | null;
  reason?: string | null;
  payload?: Prisma.JsonObject;
  force?: boolean;
  tx?: Prisma.TransactionClient;
}

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  async getByTenant(tenantId: string): Promise<Subscription | null> {
    return this.prisma.subscription.findUnique({ where: { tenantId } });
  }

  async getByTenantOrFail(tenantId: string): Promise<Subscription> {
    const sub = await this.getByTenant(tenantId);
    if (!sub) {
      throw new NotFoundException(`Подписка для tenantId=${tenantId} не найдена`);
    }
    return sub;
  }

  async ensureDemo(tenantId: string, tx?: Prisma.TransactionClient): Promise<Subscription> {
    const client = tx ?? this.prisma;
    const existing = await client.subscription.findUnique({
      where: { tenantId },
    });
    if (existing) return existing;

    const created = await client.subscription.create({
      data: { tenantId },
    });
    await client.subscriptionEvent.create({
      data: {
        subscriptionId: created.id,
        eventType: SubscriptionEventType.CREATED,
        payload: { initial: true },
      },
    });
    return created;
  }

  async transition(
    tenantId: string,
    options: TransitionOptions & {
      dataPatch?: Prisma.SubscriptionUncheckedUpdateInput;
    },
  ): Promise<Subscription> {
    const runner = options.tx ?? this.prisma;
    const current = await runner.subscription.findUnique({ where: { tenantId } });
    if (!current) {
      throw new NotFoundException(`Подписка для tenantId=${tenantId} не найдена`);
    }

    if (!options.force) {
      assertCanTransition(current.status, options.to);
    }

    const patch = options.dataPatch ?? {};

    const updated = await runner.subscription.update({
      where: { id: current.id },
      data: {
        ...patch,
        status: options.to,
      },
    });

    const eventType = options.force
      ? SubscriptionEventType.STATUS_FORCED
      : this.statusToEventType(options.to, current.status);

    await runner.subscriptionEvent.create({
      data: {
        subscriptionId: updated.id,
        eventType,
        payload: {
          fromStatus: current.status,
          toStatus: options.to,
          ...(options.payload ?? {}),
        },
        byUserId: options.byUserId ?? null,
        reason: options.reason ?? null,
      },
    });

    try {
      this.emitForTransition(updated, current.status, options.to);
    } catch (err) {
      this.logger.warn(
        `emitForTransition (${current.status}→${options.to}, sub=${updated.id}) синхронно упал: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return updated;
  }

  async setSeatsExtra(args: {
    tenantId: string;
    newSeatsExtra: number;
    byUserId: string;
    reason: string;
  }): Promise<Subscription> {
    const current = await this.getByTenantOrFail(args.tenantId);
    if (current.seatsExtra === args.newSeatsExtra) return current;

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.subscription.update({
        where: { id: current.id },
        data: { seatsExtra: args.newSeatsExtra },
      });
      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: u.id,
          eventType: SubscriptionEventType.SEATS_CHANGED,
          payload: {
            seatsExtraBefore: current.seatsExtra,
            seatsExtraAfter: args.newSeatsExtra,
          },
          byUserId: args.byUserId,
          reason: args.reason,
        },
      });
      return u;
    });

    const payload: SubscriptionSeatsChangedPayload = {
      tenantId: updated.tenantId,
      subscriptionId: updated.id,
      seatsExtraBefore: current.seatsExtra,
      seatsExtraAfter: updated.seatsExtra,
    };
    void this.safeEmit(BillingEvent.SUBSCRIPTION_SEATS_CHANGED, payload);

    return updated;
  }

  private statusToEventType(to: SubscriptionStatus, _from: SubscriptionStatus): string {
    switch (to) {
      case 'ACTIVE':
        return SubscriptionEventType.RENEWED;
      case 'PAST_DUE':
        return SubscriptionEventType.PAST_DUE;
      case 'SUSPENDED':
        return SubscriptionEventType.SUSPENDED;
      case 'CANCELED':
        return SubscriptionEventType.CANCELED;
      case 'EXPIRED':
        return SubscriptionEventType.EXPIRED;
      case 'DEMO':
        return SubscriptionEventType.CREATED;
    }
  }

  private emitForTransition(
    sub: Subscription,
    fromStatus: SubscriptionStatus,
    toStatus: SubscriptionStatus,
  ): void {
    if (fromStatus === toStatus) return;
    if (toStatus === 'EXPIRED') {
      const payload: SubscriptionExpiredPayload = {
        tenantId: sub.tenantId,
        subscriptionId: sub.id,
      };
      void this.safeEmit(BillingEvent.SUBSCRIPTION_EXPIRED, payload);
    } else if (toStatus === 'PAST_DUE') {
      void this.safeEmit(BillingEvent.SUBSCRIPTION_PAST_DUE, {
        tenantId: sub.tenantId,
        subscriptionId: sub.id,
      });
    }
  }

  private async safeEmit(eventName: string, payload: unknown): Promise<void> {
    try {
      await this.events.emitAsync(eventName, payload);
    } catch (err) {
      this.logger.warn(
        `BillingEvent ${eventName}: emit упал: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
