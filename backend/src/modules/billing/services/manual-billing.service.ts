/**
 * ManualBillingService — admin-операции с подпиской.
 *
 * Главные сценарии (ТЗ §11.4 + §14 Фаза 4):
 *   - activate({paymentMode: 'paid' | 'bonus'}) — включить ACTIVE-подписку
 *     с обязательным `reason`. Создаёт Invoice + грант MeetingsBalance.
 *   - adjustSeats({newSeatsExtra, reason}) — изменить число доп. мест.
 *     Pro-rata доплата создаётся как Invoice (paid в случае увеличения;
 *     при уменьшении — без Invoice, баланс встреч НЕ уменьшается).
 *   - forceStatus({newStatus, reason}) — обход FSM (super_admin only).
 *
 * Бизнес-правила:
 *   - paymentMode='paid'   → Invoice.status='paid', эмитит `invoice.paid`
 *     (триггер реф-комиссии 20 000 ₽, Фаза 6).
 *   - paymentMode='bonus' → Invoice.status='bonus', эмитит `invoice.bonus`
 *     (НЕ триггерит реф-комиссию).
 *   - При активации: грант встреч = calculateMeetingsGrant(seatsExtra).
 *   - Все операции пишут в `AdminAuditLog` (через PrismaService напрямую —
 *     `AdminAuditLogService` в Z не существует как отдельный сервис).
 *
 * Источник: plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §7.1 + §11.4.
 */

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  BillingPeriod,
  Subscription,
  SubscriptionStatus,
} from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { MeetingsBalanceService } from '../../meetings-balance/meetings-balance.service';
import {
  BillingEventType,
  InvoiceItemKind,
  SubscriptionEventType,
  type InvoiceItem,
} from '../billing.types';
import {
  BillingEvent,
  type SubscriptionActivatedPayload,
} from '../events/billing.events';

import { BillingEventService } from './billing-event.service';
import { InvoiceService } from './invoice.service';
import {
  SeatService,
  YEARLY_MONTHS,
  type SubscriptionPricing,
} from './seat.service';
import { SubscriptionService } from './subscription.service';

export interface AdminActivateInput {
  tenantId: string;
  billingPeriod: BillingPeriod;
  seatsBase?: number;
  seatsExtra: number;
  startedAt: Date;
  // 2026-06-01 — `reference` (эталонная демо-Org) активируется CLI-скриптом
  // `patch-create-reference-demo-org.ts` напрямую через Prisma, минуя
  // manual-billing/admin-billing. Поэтому admin-activate допускает только paid|bonus.
  paymentMode: 'paid' | 'bonus';
  reason: string;
  byUserId: string;
  /** Внешний референс (номер платёжки клиента). Опционален. */
  externalRef?: string | null;
}

export interface AdminAdjustSeatsInput {
  tenantId: string;
  newSeatsExtra: number;
  reason: string;
  byUserId: string;
  /** Сколько дней/месяцев осталось до конца текущего периода — для pro-rata.
   * Передаётся вызывающей стороной (в e2e/тесте — вычислимо из subscription). */
  daysLeftInMonthlyPeriod?: number;
  monthsLeftInYearlyPeriod?: number;
}

export interface AdminForceStatusInput {
  tenantId: string;
  newStatus: SubscriptionStatus;
  reason: string;
  byUserId: string;
}

@Injectable()
export class ManualBillingService {
  private readonly logger = new Logger(ManualBillingService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(SubscriptionService) private readonly subscriptions: SubscriptionService,
    @Inject(InvoiceService) private readonly invoices: InvoiceService,
    @Inject(SeatService) private readonly seats: SeatService,
    @Inject(BillingEventService) private readonly eventLog: BillingEventService,
    @Inject(MeetingsBalanceService)
    private readonly meetingsBalance: MeetingsBalanceService,
  ) {}

  /**
   * Включить ACTIVE-подписку (paid или bonus). Создаёт Invoice сразу в
   * статусе paid/bonus + грантует встречи + пишет AdminAuditLog.
   *
   * Идемпотентность: если подписка уже ACTIVE с тем же режимом и текущий
   * период покрывает заданный — отказ через ConflictException (admin должен
   * сначала отменить).
   */
  async activate(input: AdminActivateInput): Promise<{
    subscription: Subscription;
    invoiceId: string;
    grantedMeetings: number;
  }> {
    if (input.reason.trim().length < 3) {
      throw new BadRequestException(
        'reason обязателен (≥3 символа) для admin-активации',
      );
    }
    this.validateSeats(input.seatsExtra);

    // Подписка должна существовать (создана при регистрации Org). Если нет — создаём.
    let subscription = await this.subscriptions.getByTenant(input.tenantId);
    subscription ??= await this.subscriptions.ensureDemo(input.tenantId);

    if (subscription.status === 'ACTIVE' && subscription.paymentMode === input.paymentMode) {
      throw new ConflictException(
        `Подписка уже ACTIVE в режиме ${input.paymentMode}. Используйте adjust-seats / extend-period.`,
      );
    }

    // Расчёт периода и суммы.
    const periodEnd = this.calculatePeriodEnd(input.startedAt, input.billingPeriod);
    const pricing = await this.seats.calculatePricing(
      input.billingPeriod === 'monthly' ? 'monthly' : 'yearly',
      input.seatsExtra,
    );
    const items = this.buildItems(input.seatsExtra, input.billingPeriod, pricing);
    const monthlyPriceKopecks = pricing.monthlyKopecks;

    // Транзакция: Invoice (сразу paid/bonus) + Subscription update +
    // SubscriptionEvent. После tx: грант MeetingsBalance + emit.
    const grantAmount = await this.seats.calculateMeetingsGrant(input.seatsExtra);

    const txResult = await this.prisma.$transaction(async (tx) => {
      const invoice = await this.invoices.create({
        tenantId: input.tenantId,
        subscriptionId: subscription!.id,
        periodStart: input.startedAt,
        periodEnd,
        items,
        paymentMethod: 'manual_admin',
        bonusOnCreate: input.paymentMode === 'bonus',
        tx,
      });

      // Если paymentMode='paid', сразу маркируем как paid (invoice.create
      // ставит status=draft по умолчанию).
      const markedInvoice =
        input.paymentMode === 'paid'
          ? await this.invoices.markPaid(
              {
                invoiceId: invoice.id,
                paymentMode: 'paid',
                byUserId: input.byUserId,
                externalRef: input.externalRef ?? null,
              },
              tx,
            )
          : invoice;

      const eventType =
        input.paymentMode === 'paid'
          ? SubscriptionEventType.ACTIVATED_PAID
          : SubscriptionEventType.ACTIVATED_BONUS;

      const updatedSub = await this.subscriptions.transition(input.tenantId, {
        to: 'ACTIVE',
        byUserId: input.byUserId,
        reason: input.reason,
        payload: {
          eventType,
          invoiceId: markedInvoice.id,
          paymentMode: input.paymentMode,
        },
        dataPatch: {
          paymentMode: input.paymentMode,
          billingPeriod: input.billingPeriod,
          startedAt: subscription!.startedAt ?? input.startedAt,
          currentPeriodStart: input.startedAt,
          currentPeriodEnd: periodEnd,
          seatsBase: input.seatsBase ?? subscription!.seatsBase,
          seatsExtra: input.seatsExtra,
          monthlyPriceKopecks,
          totalPaidKopecks:
            input.paymentMode === 'paid'
              ? subscription!.totalPaidKopecks + markedInvoice.totalKopecks
              : subscription!.totalPaidKopecks,
          autoRenew: false, // ручная активация — без автопродления
          renewalMethod: null,
          // providerName: manual — null, потому что provider не задействован.
          providerName: null,
          providerSubscriptionId: null,
        },
        force: subscription!.status === 'DEMO' ? false : false, // FSM сам разрешит
        tx,
      });

      // BillingEventLog для аудита.
      await this.eventLog.log({
        eventType:
          input.paymentMode === 'paid'
            ? BillingEventType.MANUAL_ACTIVATE_PAID
            : BillingEventType.MANUAL_ACTIVATE_BONUS,
        tenantId: input.tenantId,
        subscriptionId: updatedSub.id,
        invoiceId: markedInvoice.id,
        payload: {
          reason: input.reason,
          byUserId: input.byUserId,
          billingPeriod: input.billingPeriod,
          seatsBase: input.seatsBase ?? subscription!.seatsBase,
          seatsExtra: input.seatsExtra,
          totalKopecks: markedInvoice.totalKopecks,
        },
        markProcessed: true,
        tx,
      });

      // AdminAuditLog (общий для всего Z админ-аудита).
      await tx.adminAuditLog.create({
        data: {
          actorId: input.byUserId,
          action: `billing.activate.${input.paymentMode}`,
          targetType: 'subscription',
          targetId: updatedSub.id,
          payload: {
            tenantId: input.tenantId,
            invoiceId: markedInvoice.id,
            seatsExtra: input.seatsExtra,
            billingPeriod: input.billingPeriod,
            reason: input.reason,
          },
        },
      });

      return { subscription: updatedSub, invoiceId: markedInvoice.id };
    });

    // Side-effects ПОСЛЕ транзакции.
    await this.meetingsBalance.grant(input.tenantId, grantAmount);

    const activatedPayload: SubscriptionActivatedPayload = {
      tenantId: txResult.subscription.tenantId,
      subscriptionId: txResult.subscription.id,
      paymentMode: input.paymentMode,
      billingPeriod: input.billingPeriod,
      periodStart: input.startedAt,
      periodEnd,
      seatsBase: txResult.subscription.seatsBase,
      seatsExtra: txResult.subscription.seatsExtra,
    };
    const eventName =
      input.paymentMode === 'paid'
        ? BillingEvent.SUBSCRIPTION_ACTIVATED_PAID
        : BillingEvent.SUBSCRIPTION_ACTIVATED_BONUS;
    void this.safeEmit(eventName, activatedPayload);

    this.logger.log(
      `Activated subscription org=${input.tenantId} mode=${input.paymentMode} ` +
        `period=${input.billingPeriod} seats=${input.seatsExtra} grant=${grantAmount}`,
    );

    return {
      subscription: txResult.subscription,
      invoiceId: txResult.invoiceId,
      grantedMeetings: grantAmount,
    };
  }

  /**
   * Изменить число доп. мест. При увеличении — pro-rata доплата (Invoice
   * paid сразу) + грант доп. встреч. При уменьшении — обновляем счётчик,
   * без счёта и без отъёма баланса.
   */
  async adjustSeats(input: AdminAdjustSeatsInput): Promise<{
    subscription: Subscription;
    invoiceId: string | null;
    grantedMeetings: number;
  }> {
    if (input.reason.trim().length < 3) {
      throw new BadRequestException('reason обязателен (≥3 символа)');
    }
    this.validateSeats(input.newSeatsExtra);

    const sub = await this.subscriptions.getByTenantOrFail(input.tenantId);
    if (sub.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Подписка не ACTIVE (${sub.status}) — изменение мест возможно только в ACTIVE`,
      );
    }

    const diff = input.newSeatsExtra - sub.seatsExtra;
    if (diff === 0) {
      return { subscription: sub, invoiceId: null, grantedMeetings: 0 };
    }

    // Уменьшение — без счёта.
    if (diff < 0) {
      const updated = await this.subscriptions.setSeatsExtra({
        tenantId: input.tenantId,
        newSeatsExtra: input.newSeatsExtra,
        byUserId: input.byUserId,
        reason: input.reason,
      });
      await this.eventLog.log({
        eventType: BillingEventType.MANUAL_ADJUST_SEATS,
        tenantId: input.tenantId,
        subscriptionId: updated.id,
        payload: { diff, reason: input.reason, byUserId: input.byUserId },
        markProcessed: true,
      });
      return { subscription: updated, invoiceId: null, grantedMeetings: 0 };
    }

    // Увеличение — pro-rata доплата.
    const prorata =
      sub.billingPeriod === 'yearly'
        ? await this.seats.calculateAddSeatsYearlyProrata({
            seatsToAdd: diff,
            monthsLeftInPeriod: input.monthsLeftInYearlyPeriod ?? YEARLY_MONTHS,
          })
        : await this.seats.calculateAddSeatsMonthlyProrata({
            seatsToAdd: diff,
            daysLeftInPeriod: input.daysLeftInMonthlyPeriod ?? 30,
          });

    const items: InvoiceItem[] = [
      {
        kind: InvoiceItemKind.SEATS_PRORATA,
        qty: diff,
        unitKopecks: 100_000, // PER_EXTRA_SEAT_KOPECKS
        totalKopecks: prorata,
        note: `Pro-rata доплата за +${diff} мест (${sub.billingPeriod ?? 'period'})`,
      },
    ];

    const txResult = await this.prisma.$transaction(async (tx) => {
      const invoice = await this.invoices.create({
        tenantId: input.tenantId,
        subscriptionId: sub.id,
        periodStart: sub.currentPeriodStart ?? new Date(),
        periodEnd: sub.currentPeriodEnd ?? new Date(),
        items,
        paymentMethod: 'manual_admin',
        tx,
      });
      const paidInvoice = await this.invoices.markPaid(
        {
          invoiceId: invoice.id,
          paymentMode: 'paid',
          byUserId: input.byUserId,
        },
        tx,
      );
      const updatedSub = await tx.subscription.update({
        where: { id: sub.id },
        data: {
          seatsExtra: input.newSeatsExtra,
          totalPaidKopecks: sub.totalPaidKopecks + paidInvoice.totalKopecks,
        },
      });
      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: updatedSub.id,
          eventType: SubscriptionEventType.SEATS_CHANGED,
          payload: { diff, invoiceId: paidInvoice.id, prorataKopecks: prorata },
          byUserId: input.byUserId,
          reason: input.reason,
        },
      });
      await this.eventLog.log({
        eventType: BillingEventType.MANUAL_ADJUST_SEATS,
        tenantId: input.tenantId,
        subscriptionId: updatedSub.id,
        invoiceId: paidInvoice.id,
        payload: { diff, prorataKopecks: prorata, reason: input.reason },
        markProcessed: true,
        tx,
      });
      await tx.adminAuditLog.create({
        data: {
          actorId: input.byUserId,
          action: 'billing.adjust_seats',
          targetType: 'subscription',
          targetId: updatedSub.id,
          payload: { tenantId: input.tenantId, diff, invoiceId: paidInvoice.id },
        },
      });
      return { subscription: updatedSub, invoiceId: paidInvoice.id };
    });

    // Грант доп. встреч за добавленные места.
    // Источник правды — AdminSetting `billing.perExtraSeatMeetingsGrant` через
    // MeetingsBalanceService (см. ТЗ 2026-05-31 §3.1). Code-fallback внутри
    // сервиса = 5 встреч/место.
    const perExtraSeatMeetingsGrant =
      await this.meetingsBalance.getPerExtraSeatMeetingsGrant();
    const grantAmount = diff * perExtraSeatMeetingsGrant;
    await this.meetingsBalance.grant(input.tenantId, grantAmount);

    return { ...txResult, grantedMeetings: grantAmount };
  }

  /**
   * Force-status — обход FSM. Только для super_admin (проверка guard'ом).
   * Записывается eventType='status_forced' с обязательным reason.
   */
  async forceStatus(input: AdminForceStatusInput): Promise<Subscription> {
    if (input.reason.trim().length < 3) {
      throw new BadRequestException('reason обязателен (≥3 символа)');
    }
    const updated = await this.subscriptions.transition(input.tenantId, {
      to: input.newStatus,
      byUserId: input.byUserId,
      reason: input.reason,
      force: true,
    });
    await this.eventLog.log({
      eventType: BillingEventType.MANUAL_FORCE_STATUS,
      tenantId: input.tenantId,
      subscriptionId: updated.id,
      payload: {
        newStatus: input.newStatus,
        reason: input.reason,
        byUserId: input.byUserId,
      },
      markProcessed: true,
    });
    await this.prisma.adminAuditLog.create({
      data: {
        actorId: input.byUserId,
        action: 'billing.force_status',
        targetType: 'subscription',
        targetId: updated.id,
        payload: {
          tenantId: input.tenantId,
          newStatus: input.newStatus,
          reason: input.reason,
        },
      },
    });
    return updated;
  }

  // ──────────────────────── private ────────────────────────

  private buildItems(
    seatsExtra: number,
    billingPeriod: BillingPeriod,
    pricing: SubscriptionPricing,
  ): InvoiceItem[] {
    const months = pricing.monthsInPeriod;
    const items: InvoiceItem[] = [
      {
        kind: InvoiceItemKind.BASE,
        qty: months,
        unitKopecks: pricing.baseMonthlyKopecks,
        totalKopecks: pricing.baseMonthlyKopecks * months,
        note:
          months === 1
            ? 'Подписка tier_standard (1 месяц)'
            : `Подписка tier_standard (${months} мес)`,
      },
    ];
    if (seatsExtra > 0) {
      items.push({
        kind: InvoiceItemKind.SEATS,
        qty: seatsExtra,
        unitKopecks: pricing.seatsExtraKopecks / seatsExtra,
        totalKopecks: pricing.seatsExtraKopecks * months,
        note: `Доп. места: ${seatsExtra} × ${months} мес`,
      });
    }
    if (billingPeriod === 'yearly' && pricing.discountKopecks > 0) {
      items.push({
        kind: InvoiceItemKind.YEARLY_DISCOUNT,
        qty: 1,
        unitKopecks: -pricing.discountKopecks,
        totalKopecks: -pricing.discountKopecks,
        note: 'Скидка за годовую подписку 20%',
      });
    }
    return items;
  }

  private calculatePeriodEnd(start: Date, period: BillingPeriod): Date {
    const end = new Date(start);
    if (period === 'yearly') {
      end.setUTCFullYear(end.getUTCFullYear() + 1);
    } else {
      end.setUTCMonth(end.getUTCMonth() + 1);
    }
    return end;
  }

  private validateSeats(seatsExtra: number): void {
    if (!Number.isInteger(seatsExtra) || seatsExtra < 0 || seatsExtra > 10_000) {
      throw new BadRequestException(
        `seatsExtra должен быть целым в [0..10000] (получено ${seatsExtra})`,
      );
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
