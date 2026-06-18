import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SubscriptionStatus } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';

import { SubscriptionService } from './subscription.service';

const LOCK_KEY = 'billing:cycle-cron:lock';
const LOCK_TTL_SECONDS = 600;
const SYSTEM_USER_ID = 'system:billing-cycle';

interface CronCounters {
  pastDueToSuspended: number;
  canceledToExpired: number;
  activeBonusToExpired: number;
  activePaidToPastDue: number;
}

@Injectable()
export class BillingCycleCron {
  private readonly logger = new Logger(BillingCycleCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(SubscriptionService) private readonly subscriptions: SubscriptionService,
  ) {}

  @Cron('0 3 * * *', { timeZone: 'Europe/Moscow' })
  async run(): Promise<void> {
    const acquired = await this.redis.client.set(
      LOCK_KEY,
      Date.now().toString(),
      'EX',
      LOCK_TTL_SECONDS,
      'NX',
    );
    if (acquired !== 'OK') {
      this.logger.warn(`BillingCycleCron: лок ${LOCK_KEY} занят — пропускаем запуск`);
      return;
    }

    const counters: CronCounters = {
      pastDueToSuspended: 0,
      canceledToExpired: 0,
      activeBonusToExpired: 0,
      activePaidToPastDue: 0,
    };

    try {
      const now = new Date();
      counters.pastDueToSuspended = await this.processPastDueToSuspended(now);
      counters.canceledToExpired = await this.processCanceledToExpired(now);
      counters.activeBonusToExpired = await this.processActiveBonusToExpired(now);
      counters.activePaidToPastDue = await this.processActivePaidToPastDue(now);

      this.logger.debug(`BillingCycleCron OK: ${JSON.stringify(counters)}`);
    } catch (err) {
      this.logger.error(
        `BillingCycleCron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    } finally {
      await this.redis.client.del(LOCK_KEY).catch(() => {});
    }
  }

  private async processPastDueToSuspended(now: Date): Promise<number> {
    const candidates = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.PAST_DUE,
        pastDueUntil: { lt: now },
      },
      select: { tenantId: true, id: true },
    });
    for (const sub of candidates) {
      await this.subscriptions.transition(sub.tenantId, {
        to: SubscriptionStatus.SUSPENDED,
        byUserId: SYSTEM_USER_ID,
        reason: 'grace_period_expired',
      });
    }
    return candidates.length;
  }

  private async processCanceledToExpired(now: Date): Promise<number> {
    const candidates = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.CANCELED,
        currentPeriodEnd: { lt: now },
      },
      select: { tenantId: true, id: true },
    });
    for (const sub of candidates) {
      await this.subscriptions.transition(sub.tenantId, {
        to: SubscriptionStatus.EXPIRED,
        byUserId: SYSTEM_USER_ID,
        reason: 'canceled_period_ended',
      });
    }
    return candidates.length;
  }

  private async processActiveBonusToExpired(now: Date): Promise<number> {
    const candidates = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        paymentMode: 'bonus',
        currentPeriodEnd: { lt: now },
      },
      select: { tenantId: true, id: true },
    });
    for (const sub of candidates) {
      await this.subscriptions.transition(sub.tenantId, {
        to: SubscriptionStatus.EXPIRED,
        byUserId: SYSTEM_USER_ID,
        reason: 'bonus_period_ended',
      });
    }
    return candidates.length;
  }

  private async processActivePaidToPastDue(now: Date): Promise<number> {
    const candidates = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        paymentMode: 'paid',
        autoRenew: true,
        currentPeriodEnd: { lt: now },
      },
      select: { tenantId: true, id: true },
    });
    const graceUntil = new Date(now);
    graceUntil.setDate(graceUntil.getDate() + 7);

    for (const sub of candidates) {
      await this.subscriptions.transition(sub.tenantId, {
        to: SubscriptionStatus.PAST_DUE,
        byUserId: SYSTEM_USER_ID,
        reason: 'autopay_due',
        dataPatch: { pastDueUntil: graceUntil },
      });
    }
    return candidates.length;
  }
}
