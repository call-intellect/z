import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PushSubscription as PrismaPushSubscription } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/typed-config.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { PushSubscriptionView } from '../dto/push-subscription.dto';

@Injectable()
export class PushSubscriptionsService {
  private readonly logger = new Logger(PushSubscriptionsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async subscribe(args: {
    tenantId: string;
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent?: string;
    expiresAt?: Date | null;
  }): Promise<PrismaPushSubscription> {
    const data = {
      tenantId: args.tenantId,
      userId: args.userId,
      endpoint: args.endpoint,
      p256dh: args.p256dh,
      auth: args.auth,
      userAgent: args.userAgent ?? null,
      expiresAt: args.expiresAt ?? null,
      lastSeenAt: new Date(),
      failureCount: 0,
    };
    const sub = await this.prisma.pushSubscription.upsert({
      where: {
        userId_endpoint: { userId: args.userId, endpoint: args.endpoint },
      },
      create: data,
      update: {
        p256dh: args.p256dh,
        auth: args.auth,
        userAgent: args.userAgent ?? null,
        expiresAt: args.expiresAt ?? null,
        lastSeenAt: new Date(),
        failureCount: 0,
      },
    });
    return sub;
  }

  async unsubscribe(args: { userId: string; endpoint: string }): Promise<{ deleted: number }> {
    const res = await this.prisma.pushSubscription.deleteMany({
      where: { userId: args.userId, endpoint: args.endpoint },
    });
    return { deleted: res.count };
  }

  async listMine(args: { userId: string }): Promise<PrismaPushSubscription[]> {
    return this.prisma.pushSubscription.findMany({
      where: { userId: args.userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listForUser(args: { tenantId: string; userId: string }): Promise<PrismaPushSubscription[]> {
    return this.prisma.pushSubscription.findMany({
      where: { tenantId: args.tenantId, userId: args.userId },
    });
  }

  async markFailure(args: {
    subscriptionId: string;
  }): Promise<{ failureCount: number; deleted: boolean }> {
    const max = this.cfg.push.maxFailures;
    const updated = await this.prisma.pushSubscription.update({
      where: { id: args.subscriptionId },
      data: { failureCount: { increment: 1 } },
      select: { id: true, failureCount: true },
    });
    if (updated.failureCount >= max) {
      await this.prisma.pushSubscription.delete({
        where: { id: args.subscriptionId },
      });
      this.logger.log(
        `markFailure: подписка ${args.subscriptionId} удалена (failureCount=${updated.failureCount}, max=${max})`,
      );
      return { failureCount: updated.failureCount, deleted: true };
    }
    return { failureCount: updated.failureCount, deleted: false };
  }

  async markSuccess(args: { subscriptionId: string }): Promise<void> {
    await this.prisma.pushSubscription.update({
      where: { id: args.subscriptionId },
      data: { lastSeenAt: new Date(), failureCount: 0 },
    });
  }

  toView(sub: PrismaPushSubscription): PushSubscriptionView {
    return {
      id: sub.id,
      endpoint: sub.endpoint,
      userAgent: sub.userAgent,
      lastSeenAt: sub.lastSeenAt.toISOString(),
      createdAt: sub.createdAt.toISOString(),
    };
  }
}
