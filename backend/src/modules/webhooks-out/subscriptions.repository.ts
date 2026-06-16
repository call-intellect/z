import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, WebhookDelivery, WebhookSubscription } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class SubscriptionsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  countByUser(userId: string): Promise<number> {
    return this.prisma.webhookSubscription.count({ where: { userId } });
  }

  listByUser(userId: string): Promise<WebhookSubscription[]> {
    return this.prisma.webhookSubscription.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  findById(id: string): Promise<WebhookSubscription | null> {
    return this.prisma.webhookSubscription.findUnique({ where: { id } });
  }

  async findByUserAndEvent(userId: string, event: string): Promise<WebhookSubscription[]> {
    return this.prisma.webhookSubscription.findMany({
      where: {
        userId,
        status: 'active',
        events: { has: event },
      },
    });
  }

  create(input: {
    userId: string;
    url: string;
    events: string[];
    secretEncrypted: string;
    secretPrefix: string;
  }): Promise<WebhookSubscription> {
    return this.prisma.webhookSubscription.create({
      data: {
        userId: input.userId,
        url: input.url,
        events: input.events,
        secretEncrypted: input.secretEncrypted,
        secretPrefix: input.secretPrefix,
      },
    });
  }

  delete(id: string): Promise<WebhookSubscription> {
    return this.prisma.webhookSubscription.delete({ where: { id } });
  }

  updateStatus(
    id: string,
    data: Partial<Pick<WebhookSubscription, 'status' | 'lastDeliveryAt'>>,
  ): Promise<WebhookSubscription> {
    return this.prisma.webhookSubscription.update({
      where: { id },
      data,
    });
  }

  countConsecutiveFailed(subscriptionId: string): Promise<number> {
    return this.prisma.webhookDelivery.count({
      where: { subscriptionId, status: 'failed' },
    });
  }

  createDelivery(input: {
    subscriptionId: string;
    event: string;
    eventId: string;
    payload: unknown;
  }): Promise<WebhookDelivery> {
    return this.prisma.webhookDelivery.create({
      data: {
        subscriptionId: input.subscriptionId,
        event: input.event,
        eventId: input.eventId,
        payload: input.payload as Prisma.InputJsonValue,
      },
    });
  }

  findDelivery(id: string): Promise<WebhookDelivery | null> {
    return this.prisma.webhookDelivery.findUnique({ where: { id } });
  }

  listDeliveries(input: {
    subscriptionId: string;
    limit: number;
    offset: number;
  }): Promise<WebhookDelivery[]> {
    return this.prisma.webhookDelivery.findMany({
      where: { subscriptionId: input.subscriptionId },
      orderBy: { createdAt: 'desc' },
      take: input.limit,
      skip: input.offset,
    });
  }

  updateDelivery(id: string, data: Prisma.WebhookDeliveryUpdateInput): Promise<WebhookDelivery> {
    return this.prisma.webhookDelivery.update({ where: { id }, data });
  }
}
