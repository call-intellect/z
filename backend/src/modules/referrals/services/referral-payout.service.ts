import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { Prisma, type ReferralPayout, type ReferralPayoutStatus } from '@prisma/client';
import { type Job, Queue, Worker } from 'bullmq';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { BillingEvent, type InvoicePaidPayload } from '../../billing/events/billing.events';

import { AttributionService } from './attribution.service';

export const REFERRAL_COMMISSION_KOPECKS = 2_000_000;

const PAYOUT_CRON_LOCK_KEY = 'referral:payout-cron:lock';
const PAYOUT_CRON_LOCK_TTL_SECONDS = 1800;

export const REFERRAL_PAYOUT_QUEUE_NAME = 'billing.referral-payout';

@Injectable()
export class ReferralPayoutService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReferralPayoutService.name);

  private payoutQueue: Queue<InvoicePaidPayload> | null = null;
  private payoutWorker: Worker<InvoicePaidPayload> | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(AttributionService) private readonly attribution: AttributionService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
  ) {}

  onModuleInit(): void {
    const connection = this.redis.client;
    this.payoutQueue = new Queue<InvoicePaidPayload>(REFERRAL_PAYOUT_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: { age: 86_400, count: 500 },
        removeOnFail: false,
      },
    });
    this.payoutWorker = new Worker<InvoicePaidPayload>(
      REFERRAL_PAYOUT_QUEUE_NAME,
      async (job: Job<InvoicePaidPayload>) => {
        await this.processInvoicePaid(job.data);
      },
      {
        connection,
        concurrency: 4,
      },
    );
    this.payoutWorker.on('failed', (job, err) => {
      this.logger.error(
        `referral-payout job failed (id=${job?.id ?? 'unknown'} attempt=${job?.attemptsMade ?? '?'}): ${err.message}`,
      );
    });
    this.logger.log(
      `ReferralPayout BullMQ-queue '${REFERRAL_PAYOUT_QUEUE_NAME}' инициализирован (worker concurrency=4)`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.payoutWorker?.close();
    } catch (err) {
      this.logger.warn(
        `Закрытие payoutWorker: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      await this.payoutQueue?.close();
    } catch (err) {
      this.logger.warn(`Закрытие payoutQueue: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.payoutWorker = null;
    this.payoutQueue = null;
  }

  @OnEvent(BillingEvent.INVOICE_PAID, { async: true })
  async onInvoicePaid(payload: InvoicePaidPayload): Promise<void> {
    if (!this.payoutQueue) {
      this.logger.warn('onInvoicePaid: payoutQueue ещё не инициализирован, fallback inline');
      await this.processInvoicePaid(payload);
      return;
    }
    try {
      await this.payoutQueue.add('invoice-paid', payload, {
        jobId: `invoice_${payload.invoiceId}`,
      });
    } catch (err) {
      this.logger.error(
        `onInvoicePaid: не удалось enqueue payout job (invoice=${payload.invoiceId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async processInvoicePaid(payload: InvoicePaidPayload): Promise<void> {
    try {
      if (payload.paymentMode !== 'paid') {
        return;
      }
      if (!payload.subscriptionId) {
        return;
      }

      const sub = await this.prisma.subscription.findUnique({
        where: { id: payload.subscriptionId },
        include: { clientReferralLink: true },
      });
      if (!sub) return;

      let clientLink = sub.clientReferralLink;

      if (!clientLink) {
        const pending = await this.attribution.resolvePendingForOrg(payload.tenantId);
        if (!pending) {
          this.logger.log(
            `invoice.paid: no pending attribution for org=${payload.tenantId} — skip`,
          );
          return;
        }
        clientLink = await this.prisma.clientReferralLink.create({
          data: {
            tenantId: payload.tenantId,
            referralId: pending.referralId,
            subscriptionId: sub.id,
            firstPaidAt: new Date(),
          },
        });
        await this.attribution.clearPendingForOrg(payload.tenantId);
        this.logger.log(
          `First-touch ClientReferralLink создан (org=${payload.tenantId}, referral=${pending.referralId})`,
        );
      } else if (!clientLink.firstPaidAt) {
        clientLink = await this.prisma.clientReferralLink.update({
          where: { id: clientLink.id },
          data: { firstPaidAt: new Date() },
        });
      }

      const periodMonth = this.formatPeriodMonth(payload.paidAt);
      try {
        await this.prisma.referralPayout.create({
          data: {
            referralId: clientLink.referralId,
            clientReferralLinkId: clientLink.id,
            triggerInvoiceId: payload.invoiceId,
            periodMonth,
            amountKopecks: REFERRAL_COMMISSION_KOPECKS,
            status: 'pending',
          },
        });
        this.metrics.incReferralPayoutCreated({
          cronRunDate: payload.paidAt.toISOString().slice(0, 10),
        });
        this.metrics.incReferralPayoutAmountRub(REFERRAL_COMMISSION_KOPECKS / 100);
        this.logger.log(
          `ReferralPayout pending создан: ${REFERRAL_COMMISSION_KOPECKS}коп для referral=${clientLink.referralId} period=${periodMonth}`,
        );
      } catch (createErr) {
        if (
          createErr instanceof Prisma.PrismaClientKnownRequestError &&
          createErr.code === 'P2002'
        ) {
          this.logger.log(
            `ReferralPayout для invoice=${payload.invoiceId} уже существует (P2002) — skip (idempotent)`,
          );
          return;
        }
        throw createErr;
      }
    } catch (err) {
      this.logger.error(
        `onInvoicePaid failed for invoice=${payload.invoiceId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  @Cron('0 10 10 * *', { timeZone: 'Europe/Moscow' })
  async runMonthlyClose(): Promise<void> {
    const acquired = await this.redis.client.set(
      PAYOUT_CRON_LOCK_KEY,
      Date.now().toString(),
      'EX',
      PAYOUT_CRON_LOCK_TTL_SECONDS,
      'NX',
    );
    if (acquired !== 'OK') {
      this.logger.warn(`ReferralPayoutCron: лок занят — пропускаем`);
      return;
    }

    try {
      const now = new Date();
      const periodMonth = this.formatPeriodMonth(this.previousMonth(now));
      await this.closePeriod(periodMonth);
    } finally {
      await this.redis.client.del(PAYOUT_CRON_LOCK_KEY).catch(() => {});
    }
  }

  async closePeriod(periodMonth: string): Promise<{
    paid: number;
    voided: number;
    skipped: number;
  }> {
    const pending = await this.prisma.referralPayout.findMany({
      where: { periodMonth, status: 'pending' },
      include: {
        referral: {
          select: {
            id: true,
            innVerifiedAt: true,
            contractAcceptedAt: true,
            payoutDetails: true,
            slug: true,
          },
        },
      },
    });

    let paid = 0;
    let voided = 0;
    let skipped = 0;
    const now = new Date();

    for (const payout of pending) {
      const payoutDetails = payout.referral.payoutDetails;
      const hasPayoutDetails =
        payoutDetails != null &&
        typeof payoutDetails === 'object' &&
        !Array.isArray(payoutDetails) &&
        Object.keys(payoutDetails as Record<string, unknown>).length > 0;
      const verified =
        payout.referral.innVerifiedAt != null &&
        payout.referral.contractAcceptedAt != null &&
        hasPayoutDetails;
      if (!verified) {
        await this.prisma.referralPayout.update({
          where: { id: payout.id },
          data: {
            status: 'void',
            voidReason: 'referral_not_verified',
          },
        });
        voided += 1;
        continue;
      }
      try {
        await this.prisma.referralPayout.update({
          where: { id: payout.id },
          data: {
            status: 'paid',
            paidAt: now,
          },
        });
        paid += 1;
      } catch (err) {
        skipped += 1;
        this.logger.warn(
          `closePeriod payout=${payout.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.logger.log(`closePeriod ${periodMonth}: paid=${paid} voided=${voided} skipped=${skipped}`);
    return { paid, voided, skipped };
  }

  async markPaidByAdmin(args: {
    payoutId: string;
    payoutDocumentUrl?: string | null;
  }): Promise<ReferralPayout> {
    const payout = await this.prisma.referralPayout.findUnique({
      where: { id: args.payoutId },
    });
    if (!payout) {
      throw new NotFoundException(`ReferralPayout ${args.payoutId} не найден`);
    }
    if (payout.status === 'paid') return payout;
    if (payout.status === 'void') {
      throw new Error(`Payout ${args.payoutId} в статусе void — нельзя пометить paid`);
    }
    return this.prisma.referralPayout.update({
      where: { id: payout.id },
      data: {
        status: 'paid',
        paidAt: new Date(),
        payoutDocumentUrl: args.payoutDocumentUrl ?? payout.payoutDocumentUrl,
      },
    });
  }

  async voidByAdmin(args: { payoutId: string; voidReason: string }): Promise<ReferralPayout> {
    const payout = await this.prisma.referralPayout.findUnique({
      where: { id: args.payoutId },
    });
    if (!payout) {
      throw new NotFoundException(`ReferralPayout ${args.payoutId} не найден`);
    }
    if (payout.status === 'void') return payout;
    return this.prisma.referralPayout.update({
      where: { id: payout.id },
      data: {
        status: 'void',
        voidReason: args.voidReason,
      },
    });
  }

  async list(args: {
    status?: ReferralPayoutStatus;
    periodMonth?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: ReferralPayout[]; total: number }> {
    const where: Prisma.ReferralPayoutWhereInput = {
      ...(args.status ? { status: args.status } : {}),
      ...(args.periodMonth ? { periodMonth: args.periodMonth } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.referralPayout.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: args.limit ?? 50,
        skip: args.offset ?? 0,
        include: {
          referral: { select: { slug: true, inn: true, legalForm: true } },
        },
      }),
      this.prisma.referralPayout.count({ where }),
    ]);
    return { items, total };
  }

  private formatPeriodMonth(d: Date): string {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  private previousMonth(d: Date): Date {
    const result = new Date(d);
    result.setUTCMonth(result.getUTCMonth() - 1);
    return result;
  }
}
