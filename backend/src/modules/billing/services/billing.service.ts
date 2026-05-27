/**
 * BillingService — фасад над провайдером + finalizePaidInvoice.
 *
 * Главные методы:
 *   - `handleProviderWebhook(headers, body)` — обработать webhook от Точки:
 *      verify signature → parse → dedup → BillingEventLog → finalizePaidInvoice
 *      при status='APPROVED'.
 *   - `finalizePaidInvoice(invoiceId, params)` — atomic Subscription update +
 *      Invoice markPaid + BillingOperation/SubscriptionEvent. После tx:
 *      fire-and-forget эмит для реф-комиссии (Фаза 6).
 *
 * Webhook-эндпоинт ВСЕГДА отвечает 200, даже на:
 *   - invalid signature (логируем, не падаем)
 *   - дубликат (BillingEventLog.externalEventId уже есть → skip)
 *   - не найденный invoice (логируем, не падаем — Точка не должна ретраить)
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §7.4 + port-brief §13.
 */

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { BillingPeriod, Org } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  BILLING_PROVIDER,
  BillingEventType,
  InvoiceItemKind,
  type InvoiceItem,
} from '../billing.types';
import {
  BillingEvent,
  type InvoicePaidPayload,
} from '../events/billing.events';
import type {
  BillingProviderPort,
  CreateBankInvoiceRequest,
  CreatePaymentRequest,
  CreateRecurringSubscriptionRequest,
} from '../providers/billing-provider.port';

import { BillingEventService } from './billing-event.service';
import { InvoiceService } from './invoice.service';
import { SeatService, YEARLY_MONTHS } from './seat.service';
import { SubscriptionService } from './subscription.service';

export interface WebhookHandleResult {
  ok: boolean;
  reason?: 'invalid_signature' | 'duplicate' | 'no_invoice' | 'processed';
  invoiceId?: string;
}

export interface CreateCardPaymentInput {
  tenantId: string;
  billingPeriod: BillingPeriod;
  seatsExtra: number;
  /** Если true — создаётся рекуррент-подписка (saveCard + autoRenew). */
  autoRenew: boolean;
}

export interface CreateBankInvoicePaymentInput {
  tenantId: string;
  billingPeriod: BillingPeriod;
  seatsExtra: number;
  /** Если true — после создания инвойса в Точке отправляем PDF на email Org. */
  sendToEmail?: boolean;
  /** Через сколько дней истекает срок оплаты. По умолчанию 14. */
  dueInDays?: number;
}

export interface CreatePaymentResultView {
  invoiceId: string;
  invoiceNumber: string;
  totalKopecks: number;
  paymentUrl: string | null;
  providerInvoiceId: string | null;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BILLING_PROVIDER)
    private readonly provider: BillingProviderPort,
    @Inject(SubscriptionService)
    private readonly subscriptions: SubscriptionService,
    @Inject(InvoiceService) private readonly invoices: InvoiceService,
    @Inject(BillingEventService) private readonly eventLog: BillingEventService,
    @Inject(SeatService) private readonly seats: SeatService,
  ) {}

  // ════════════════════════ User-flow: card / bank-invoice ════════════════════════

  /**
   * Создать платёж картой (один разовый или с автопродлением).
   *
   * Поток:
   *   1. Проверить feature-flag tochka + card_recurring.
   *   2. Создать Invoice (status=draft, paymentMethod=card_recurring).
   *   3. provider.createRecurringSubscription({...}) если autoRenew=true,
   *      иначе provider.createPayment({...}).
   *   4. Обновить Invoice: providerInvoiceId, paymentUrl, status=issued.
   *   5. Обновить Subscription: renewalMethod=card_recurring, providerSubscriptionId.
   *
   * Финализация (status='paid') приходит позже через webhook.
   */
  async createCardPayment(
    input: CreateCardPaymentInput,
  ): Promise<CreatePaymentResultView> {
    this.assertFeature('card_recurring');
    const sub = await this.subscriptions.getByTenantOrFail(input.tenantId);
    const pricing = this.seats.calculatePricing(
      input.billingPeriod === 'yearly' ? 'yearly' : 'monthly',
      input.seatsExtra,
    );
    const periodEnd = this.calculatePeriodEnd(new Date(), input.billingPeriod);
    const items = this.buildItems(input.seatsExtra, input.billingPeriod, pricing);

    const invoice = await this.invoices.create({
      tenantId: input.tenantId,
      subscriptionId: sub.id,
      periodStart: new Date(),
      periodEnd,
      items,
      paymentMethod: 'card_recurring',
    });

    const description =
      input.billingPeriod === 'yearly'
        ? `Подписка Z tier_standard (год${input.seatsExtra > 0 ? ', +' + input.seatsExtra + ' мест' : ''})`
        : `Подписка Z tier_standard (мес${input.seatsExtra > 0 ? ', +' + input.seatsExtra + ' мест' : ''})`;

    const baseRequest = {
      invoiceId: invoice.id,
      amountKopecks: pricing.periodKopecks,
      currency: 'RUB' as const,
      description,
      paymentLinkId: invoice.id,
      customerCode: this.cfg.billing.tochka.customerCode ?? 'manual',
      returnUrl: this.cfg.billing.successRedirectUrl,
      failReturnUrl: this.cfg.billing.failRedirectUrl,
    };

    let providerInvoiceId: string | null = null;
    let providerSubscriptionId: string | null = null;
    let paymentUrl: string | null = null;
    let externalStatus: string | null = null;

    if (input.autoRenew) {
      const recurring: CreateRecurringSubscriptionRequest = {
        ...baseRequest,
        saveCard: true,
        recurring: true,
      };
      const r = await this.provider.createRecurringSubscription(recurring);
      providerSubscriptionId = r.providerSubscriptionId;
      providerInvoiceId = r.providerInvoiceId ?? null;
      paymentUrl = r.paymentUrl ?? null;
      externalStatus = r.externalStatus ?? null;
    } else {
      const oneOff: CreatePaymentRequest = {
        ...baseRequest,
        paymentMode: ['card', 'sbp'],
      };
      const r = await this.provider.createPayment(oneOff);
      providerInvoiceId = r.providerInvoiceId;
      paymentUrl = r.paymentUrl ?? null;
      externalStatus = r.externalStatus ?? null;
    }

    // Обновляем Invoice + Subscription в одной транзакции.
    const final = await this.prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          providerName: 'tochka',
          providerInvoiceId,
          paymentUrl,
          externalStatus,
          status: 'issued',
          issuedAt: new Date(),
        },
      });
      if (input.autoRenew && providerSubscriptionId) {
        await tx.subscription.update({
          where: { id: sub.id },
          data: {
            renewalMethod: 'card_recurring',
            autoRenew: true,
            providerName: 'tochka',
            providerSubscriptionId,
          },
        });
      }
      return inv;
    });

    return {
      invoiceId: final.id,
      invoiceNumber: final.invoiceNumber,
      totalKopecks: final.totalKopecks,
      paymentUrl: final.paymentUrl,
      providerInvoiceId: final.providerInvoiceId,
    };
  }

  /**
   * Создать безналичный счёт через Точку.
   *
   * Требует заполненных реквизитов в Org (inn/legalName/legalAddress + email).
   * После создания Invoice в Точке (документ создаётся на их стороне) —
   * опционально отправляем PDF на email Org.
   *
   * Финализация (status='paid') приходит через webhook когда платёжка
   * дойдёт до счёта Z в Точке.
   */
  async createBankInvoicePayment(
    input: CreateBankInvoicePaymentInput,
  ): Promise<CreatePaymentResultView> {
    this.assertFeature('bank_invoice');
    const sub = await this.subscriptions.getByTenantOrFail(input.tenantId);
    const org = await this.prisma.org.findUnique({
      where: { id: input.tenantId },
    });
    if (!org) throw new NotFoundException(`Org ${input.tenantId} не найден`);
    this.assertBillingDetailsReady(org);

    const pricing = this.seats.calculatePricing(
      input.billingPeriod === 'yearly' ? 'yearly' : 'monthly',
      input.seatsExtra,
    );
    const periodEnd = this.calculatePeriodEnd(new Date(), input.billingPeriod);
    const items = this.buildItems(input.seatsExtra, input.billingPeriod, pricing);
    const dueAt = new Date();
    dueAt.setDate(dueAt.getDate() + (input.dueInDays ?? 14));

    const invoice = await this.invoices.create({
      tenantId: input.tenantId,
      subscriptionId: sub.id,
      periodStart: new Date(),
      periodEnd,
      items,
      paymentMethod: 'bank_invoice',
      dueAt,
    });

    const customerCode = this.cfg.billing.tochka.customerCode;
    const accountId = this.cfg.billing.tochka.accountId;
    if (!customerCode || !accountId) {
      throw new BadRequestException(
        'TOCHKA_CUSTOMER_CODE и TOCHKA_ACCOUNT_ID должны быть заданы для безналичной оплаты',
      );
    }

    const bankReq: CreateBankInvoiceRequest = {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      amountKopecks: pricing.periodKopecks,
      description: `Подписка Z tier_standard (${
        input.billingPeriod === 'yearly' ? 'год' : 'мес'
      })`,
      customerCode,
      accountId,
      payer: {
        legalName: org.directorName ?? `Org ${org.name}`,
        inn: org.inn ?? '',
        kpp: org.kpp ?? null,
        legalAddress: org.legalAddress ?? '',
        contactEmail: org.contactEmail ?? '',
        contactPhone: org.contactPhone ?? null,
      },
      periodStart: new Date(),
      periodEnd,
      dueDate: dueAt,
    };
    const r = await this.provider.createBankInvoice(bankReq);

    const final = await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        providerName: 'tochka',
        providerInvoiceId: r.providerInvoiceId,
        externalStatus: r.externalStatus,
        status: 'issued',
        issuedAt: new Date(),
      },
    });

    if (input.sendToEmail && org.contactEmail) {
      await this.provider
        .sendBankInvoiceToEmail({
          providerInvoiceId: r.providerInvoiceId,
          email: org.contactEmail,
        })
        .catch((err: unknown) => {
          this.logger.warn(
            `sendBankInvoiceToEmail failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }

    return {
      invoiceId: final.id,
      invoiceNumber: final.invoiceNumber,
      totalKopecks: final.totalKopecks,
      paymentUrl: null,
      providerInvoiceId: final.providerInvoiceId,
    };
  }

  /**
   * Главный entry-point для `POST /internal/billing/provider-events`.
   * Никогда не throws — всегда возвращает 200 с reason'ом (нужно, чтобы
   * Точка не уходила в retry-loop).
   */
  async handleProviderWebhook(
    headers: Record<string, string>,
    body: unknown,
  ): Promise<WebhookHandleResult> {
    // 1. Verify подпись.
    const signatureValid = await this.provider.verifyWebhookSignature(headers, body);
    if (!signatureValid) {
      this.logger.warn('Provider webhook: signature invalid — игнорируем');
      return { ok: false, reason: 'invalid_signature' };
    }

    // 2. Parse payload.
    let event;
    try {
      event = this.provider.parseWebhook(headers, body);
    } catch (err) {
      this.logger.warn(
        `Provider webhook: parse failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { ok: false, reason: 'invalid_signature' };
    }

    // 3. Дедуп + лог.
    const { duplicate } = await this.eventLog.log({
      eventType: BillingEventType.PROVIDER_WEBHOOK,
      providerName: this.provider.providerName === 'tochka' ? 'tochka' : 'manual',
      externalEventId: event.eventId,
      payload: event.rawPayload as never,
    });
    if (duplicate) {
      return { ok: true, reason: 'duplicate' };
    }

    // 4. Найти invoice по providerInvoiceId либо по paymentLinkId (= Invoice.id).
    const invoice = await this.prisma.invoice.findFirst({
      where: {
        OR: [
          { providerInvoiceId: event.providerInvoiceId },
          { id: event.providerInvoiceId },
        ],
      },
    });
    if (!invoice) {
      this.logger.warn(
        `Provider webhook: invoice не найден по providerInvoiceId=${event.providerInvoiceId}`,
      );
      return { ok: false, reason: 'no_invoice' };
    }

    // 5. Если status='APPROVED' → finalize.
    if (event.status === 'APPROVED' || event.status === 'payment_paid') {
      await this.finalizePaidInvoice(invoice.id, {
        externalReference: event.providerInvoiceId,
      });
      return { ok: true, reason: 'processed', invoiceId: invoice.id };
    }

    // 6. Прочие статусы (REFUNDED/EXPIRED/CANCELED) — только лог, без действий.
    this.logger.log(
      `Provider webhook: invoice=${invoice.id} status=${event.status} — действий не требуется`,
    );
    return { ok: true, reason: 'processed', invoiceId: invoice.id };
  }

  /**
   * Финализация оплаченного инвойса:
   *   - markPaid в Invoice (paymentMode='paid')
   *   - update Subscription: status='ACTIVE', period dates, totalPaidKopecks
   *   - SubscriptionEvent renewed
   *   - BillingEventLog 'invoice.paid'
   *   - fire-and-forget emit `billing.invoice.paid` для реф-комиссии (Фаза 6)
   *
   * Идемпотентность: если invoice уже paid — no-op (transactionно через
   * markPaid).
   */
  async finalizePaidInvoice(
    invoiceId: string,
    params: { externalReference?: string },
  ): Promise<void> {
    const invoice = await this.invoices.findOrFail(invoiceId);
    if (invoice.status === 'paid' || invoice.status === 'bonus') {
      this.logger.log(
        `finalizePaidInvoice: invoice ${invoiceId} уже ${invoice.status} — no-op`,
      );
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      // 1. Помечаем invoice как paid (внутри tx — без эмита из InvoiceService).
      await this.invoices.markPaid(
        {
          invoiceId,
          paymentMode: 'paid',
          externalRef: params.externalReference ?? null,
        },
        tx,
      );

      // 2. Обновляем Subscription: ACTIVE + period dates из invoice.
      if (invoice.subscriptionId && invoice.periodEnd && invoice.periodStart) {
        await this.subscriptions.transition(invoice.tenantId, {
          to: 'ACTIVE',
          reason: 'provider_payment_finalized',
          payload: {
            invoiceId,
            externalReference: params.externalReference ?? null,
          },
          dataPatch: {
            paymentMode: 'paid',
            currentPeriodStart: invoice.periodStart,
            currentPeriodEnd: invoice.periodEnd,
            totalPaidKopecks: { increment: invoice.totalKopecks },
          },
          tx,
        });
      }

      // 3. BillingEventLog 'invoice.paid'.
      await this.eventLog.log({
        eventType: BillingEventType.INVOICE_PAID,
        tenantId: invoice.tenantId,
        subscriptionId: invoice.subscriptionId,
        invoiceId,
        providerName: this.provider.providerName === 'tochka' ? 'tochka' : 'manual',
        externalEventId: null,
        payload: { externalReference: params.externalReference ?? null },
        markProcessed: true,
        tx,
      });
    });

    // 4. Fire-and-forget эмит для side-effect handlers (реф-комиссия, signup-бонус).
    const payload: InvoicePaidPayload = {
      invoiceId: invoice.id,
      tenantId: invoice.tenantId,
      subscriptionId: invoice.subscriptionId,
      amountKopecks: invoice.totalKopecks,
      paymentMode: 'paid',
      paidAt: new Date(),
    };
    void this.safeEmit(BillingEvent.INVOICE_PAID, payload);
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

  // ──────────────────── helpers (pay-flow) ────────────────────

  private assertFeature(kind: 'card_recurring' | 'bank_invoice'): void {
    const features = this.cfg.billing.features;
    if (!features.tochka) {
      throw new ForbiddenException(
        'Платёжный провайдер Tochka выключен (FEATURE_BILLING_TOCHKA=false). ' +
          'Используйте админскую активацию подписки.',
      );
    }
    if (kind === 'card_recurring' && !features.cardRecurring) {
      throw new ForbiddenException(
        'Оплата картой временно выключена (FEATURE_BILLING_CARD_RECURRING=false)',
      );
    }
    if (kind === 'bank_invoice' && !features.bankInvoice) {
      throw new ForbiddenException(
        'Безналичная оплата временно выключена (FEATURE_BILLING_BANK_INVOICE=false)',
      );
    }
  }

  private assertBillingDetailsReady(org: Org): void {
    const missing: string[] = [];
    if (!org.inn?.trim()) missing.push('inn');
    if (!org.legalAddress?.trim()) missing.push('legalAddress');
    if (!org.contactEmail?.trim()) missing.push('contactEmail');
    if (!org.directorName?.trim()) missing.push('directorName');
    if (missing.length > 0) {
      throw new BadRequestException(
        `Реквизиты Org не заполнены: ${missing.join(', ')}. ` +
          'Заполните через /api/v1/billing/billing-details перед безналичной оплатой.',
      );
    }
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

  private buildItems(
    seatsExtra: number,
    billingPeriod: BillingPeriod,
    pricing: ReturnType<SeatService['calculatePricing']>,
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
}

// для будущего использования cron'ов
export { YEARLY_MONTHS };
