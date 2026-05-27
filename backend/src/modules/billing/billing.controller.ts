/**
 * BillingController — клиентский кабинет: подписка + счета + расчёт цены.
 *
 * Маршруты (под /api/v1/billing/*, auth+tenant):
 *   GET  /billing/subscription   — текущая подписка Org (или null)
 *   GET  /billing/invoices       — список счетов (paginated)
 *   GET  /billing/quote          — расчёт цены за указанный период/seats
 *
 * MeetingsBalance имеет собственный контроллер
 * (`modules/meetings-balance/`), он отвечает на `GET /billing/meetings-balance`.
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §11.1.
 */

import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Post,
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { InvoiceStatus, Subscription } from '@prisma/client';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';

import {
  InvoiceListResponseDto,
  PaymentStartResultDto,
  QuotaQuerySchema,
  QuotaResponseDto,
  StartBankInvoicePaymentBodySchema,
  StartCardPaymentBodySchema,
  SubscriptionViewDto,
  type InvoiceListResponseBody,
  type InvoiceViewBody,
  type PaymentStartResultBody,
  type QuotaQueryBody,
  type StartBankInvoicePaymentBody,
  type StartCardPaymentBody,
  type QuotaResponseBody,
  type SubscriptionViewBody,
} from './dto/billing.dto';
import { BillingService } from './services/billing.service';
import { InvoiceService } from './services/invoice.service';
import { SeatService } from './services/seat.service';
import { SubscriptionService } from './services/subscription.service';

@ApiTags('billing')
@ApiBearerAuth()
@Controller('api/v1/billing')
@UseGuards(CookieAuthGuard, TenantGuard)
export class BillingController {
  constructor(
    @Inject(SubscriptionService)
    private readonly subscriptions: SubscriptionService,
    @Inject(InvoiceService) private readonly invoices: InvoiceService,
    @Inject(SeatService) private readonly seats: SeatService,
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

  @Get('subscription')
  @ApiOperation({ summary: 'Текущая подписка Org.' })
  @ApiOkResponse({ type: SubscriptionViewDto })
  async getSubscription(
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<SubscriptionViewBody | null> {
    const t = this.requireTenant(tenantId);
    const sub = await this.subscriptions.getByTenant(t);
    return sub ? this.toSubscriptionView(sub) : null;
  }

  @Get('invoices')
  @ApiOperation({ summary: 'Список счетов Org (paginated).' })
  @ApiOkResponse({ type: InvoiceListResponseDto })
  async listInvoices(
    @CurrentOrg() tenantId: string | undefined,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('status') status?: InvoiceStatus,
  ): Promise<InvoiceListResponseBody> {
    const t = this.requireTenant(tenantId);
    const { items, total } = await this.invoices.listByTenant({
      tenantId: t,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
      statuses: status ? [status] : undefined,
    });
    return {
      items: items.map((inv) => this.toInvoiceView(inv)),
      total,
    };
  }

  @Post('pay/card')
  @ApiOperation({
    summary:
      'Старт оплаты картой через Tochka (recurring если autoRenew=true). ' +
      'Возвращает paymentUrl страницы Точки.',
  })
  @ApiOkResponse({ type: PaymentStartResultDto })
  @UsePipes(new ZodValidationPipe(StartCardPaymentBodySchema))
  async payCard(
    @Body() body: StartCardPaymentBody,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<PaymentStartResultBody> {
    const t = this.requireTenant(tenantId);
    return this.billing.createCardPayment({
      tenantId: t,
      billingPeriod: body.billingPeriod,
      seatsExtra: body.seatsExtra,
      autoRenew: body.autoRenew,
    });
  }

  @Post('pay/bank-invoice')
  @ApiOperation({
    summary:
      'Выставить безналичный счёт через Tochka. Требует заполненных реквизитов Org.',
  })
  @ApiOkResponse({ type: PaymentStartResultDto })
  @UsePipes(new ZodValidationPipe(StartBankInvoicePaymentBodySchema))
  async payBankInvoice(
    @Body() body: StartBankInvoicePaymentBody,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<PaymentStartResultBody> {
    const t = this.requireTenant(tenantId);
    return this.billing.createBankInvoicePayment({
      tenantId: t,
      billingPeriod: body.billingPeriod,
      seatsExtra: body.seatsExtra,
      dueInDays: body.dueInDays,
      sendToEmail: body.sendToEmail,
    });
  }

  @Get('quote')
  @ApiOperation({
    summary: 'Расчёт цены подписки за период/seats (без сохранения).',
  })
  @ApiOkResponse({ type: QuotaResponseDto })
  @UsePipes(new ZodValidationPipe(QuotaQuerySchema))
  getQuote(@Query() query: QuotaQueryBody): QuotaResponseBody {
    const pricing = this.seats.calculatePricing(
      query.billingPeriod,
      query.seatsExtra,
    );
    return {
      billingPeriod: query.billingPeriod,
      seatsExtra: query.seatsExtra,
      monthlyKopecks: pricing.monthlyKopecks,
      periodKopecks: pricing.periodKopecks,
      discountKopecks: pricing.discountKopecks,
      monthsInPeriod: pricing.monthsInPeriod,
      meetingsGrant: this.seats.calculateMeetingsGrant(query.seatsExtra),
    };
  }

  // ──────────────────────── helpers ────────────────────────

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new ForbiddenException('Не определён tenantId (нужен X-Org-Id)');
    }
    return tenantId;
  }

  private toSubscriptionView(sub: Subscription): SubscriptionViewBody {
    return {
      status: sub.status,
      paymentMode: sub.paymentMode,
      billingPeriod: sub.billingPeriod,
      startedAt: sub.startedAt?.toISOString() ?? null,
      currentPeriodStart: sub.currentPeriodStart?.toISOString() ?? null,
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
      seatsBase: sub.seatsBase,
      seatsExtra: sub.seatsExtra,
      monthlyPriceKopecks: sub.monthlyPriceKopecks,
      totalPaidKopecks: sub.totalPaidKopecks,
      autoRenew: sub.autoRenew,
    };
  }

  private toInvoiceView(inv: {
    id: string;
    invoiceNumber: string;
    status: InvoiceStatus;
    paymentMethod: string | null;
    totalKopecks: number;
    periodStart: Date;
    periodEnd: Date;
    paidAt: Date | null;
    voidedAt: Date | null;
    createdAt: Date;
    pdfUrl: string | null;
  }): InvoiceViewBody {
    return {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      status: inv.status,
      paymentMethod: inv.paymentMethod as InvoiceViewBody['paymentMethod'],
      totalKopecks: inv.totalKopecks,
      periodStart: inv.periodStart.toISOString(),
      periodEnd: inv.periodEnd.toISOString(),
      paidAt: inv.paidAt?.toISOString() ?? null,
      voidedAt: inv.voidedAt?.toISOString() ?? null,
      createdAt: inv.createdAt.toISOString(),
      pdfUrl: inv.pdfUrl,
    };
  }
}
