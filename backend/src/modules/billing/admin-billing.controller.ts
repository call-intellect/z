/**
 * AdminBillingController — админ-операции с подпиской и инвойсами.
 *
 * Маршруты (под /api/v1/admin/orgs/:tenantId/billing/* + /admin/billing/*,
 * super_admin only):
 *   GET   /admin/orgs/:tenantId/billing                    — карточка
 *   POST  /admin/orgs/:tenantId/billing/activate           — paid/bonus
 *   POST  /admin/orgs/:tenantId/billing/adjust-seats       — новые seats
 *   POST  /admin/orgs/:tenantId/billing/force-status       — обход FSM
 *   POST  /admin/billing/invoices/:id/mark-paid            — отметить оплаченным
 *   POST  /admin/billing/invoices/:id/void                 — отменить
 *   GET   /admin/orgs/:tenantId/billing/events             — history
 *
 * Все мутирующие действия:
 *   - требуют reason ≥3 символа (валидация на DTO-уровне),
 *   - пишутся в AdminAuditLog (через ManualBillingService),
 *   - возвращают обновлённое состояние Subscription.
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §11.4.
 */

import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Subscription } from '@prisma/client';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';

import {
  AdminActivateBodySchema,
  AdminActivateResultDto,
  AdminAdjustSeatsBodySchema,
  AdminForceStatusBodySchema,
  AdminMarkPaidBodySchema,
  AdminVoidInvoiceBodySchema,
  InvoiceViewDto,
  SubscriptionViewDto,
  type AdminActivateBody,
  type AdminActivateResultBody,
  type AdminAdjustSeatsBody,
  type AdminForceStatusBody,
  type AdminMarkPaidBody,
  type AdminVoidInvoiceBody,
  type InvoiceViewBody,
  type SubscriptionViewBody,
} from './dto/billing.dto';
import { InvoiceService } from './services/invoice.service';
import { ManualBillingService } from './services/manual-billing.service';
import { SubscriptionService } from './services/subscription.service';

@ApiTags('admin-billing')
@ApiBearerAuth()
@Controller('api/v1/admin')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
export class AdminBillingController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SubscriptionService)
    private readonly subscriptions: SubscriptionService,
    @Inject(InvoiceService) private readonly invoices: InvoiceService,
    @Inject(ManualBillingService) private readonly manual: ManualBillingService,
  ) {}

  // ──────────────────── Подписка (per-Org) ────────────────────

  @Get('orgs/:tenantId/billing')
  @ApiOperation({ summary: 'Карточка биллинга Org.' })
  @ApiOkResponse({ type: SubscriptionViewDto })
  async getOrgBilling(
    @Param('tenantId') tenantId: string,
  ): Promise<{
    subscription: SubscriptionViewBody | null;
    recentInvoices: InvoiceViewBody[];
  }> {
    const sub = await this.subscriptions.getByTenant(tenantId);
    const { items } = await this.invoices.listByTenant({
      tenantId,
      limit: 10,
    });
    return {
      subscription: sub ? this.toSubscriptionView(sub) : null,
      recentInvoices: items.map((inv) => this.toInvoiceView(inv)),
    };
  }

  @Post('orgs/:tenantId/billing/activate')
  @ApiOperation({
    summary: 'Включить ACTIVE-подписку (paid/bonus) с reason ≥3 символа.',
  })
  @ApiOkResponse({ type: AdminActivateResultDto })
  @UsePipes(new ZodValidationPipe(AdminActivateBodySchema))
  async activate(
    @Param('tenantId') tenantId: string,
    @Body() body: AdminActivateBody,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<AdminActivateResultBody> {
    const result = await this.manual.activate({
      tenantId,
      billingPeriod: body.billingPeriod,
      seatsBase: body.seatsBase,
      seatsExtra: body.seatsExtra,
      startedAt: new Date(body.startedAt),
      paymentMode: body.paymentMode,
      reason: body.reason,
      byUserId: user.id,
      externalRef: body.externalRef ?? null,
    });
    return {
      subscriptionId: result.subscription.id,
      invoiceId: result.invoiceId,
      grantedMeetings: result.grantedMeetings,
    };
  }

  @Post('orgs/:tenantId/billing/adjust-seats')
  @ApiOperation({
    summary: 'Изменить число доп. мест. При увеличении — pro-rata Invoice.',
  })
  @ApiOkResponse({ type: AdminActivateResultDto })
  @UsePipes(new ZodValidationPipe(AdminAdjustSeatsBodySchema))
  async adjustSeats(
    @Param('tenantId') tenantId: string,
    @Body() body: AdminAdjustSeatsBody,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{
    subscriptionId: string;
    invoiceId: string | null;
    grantedMeetings: number;
  }> {
    const result = await this.manual.adjustSeats({
      tenantId,
      newSeatsExtra: body.newSeatsExtra,
      reason: body.reason,
      byUserId: user.id,
      daysLeftInMonthlyPeriod: body.daysLeftInMonthlyPeriod,
      monthsLeftInYearlyPeriod: body.monthsLeftInYearlyPeriod,
    });
    return {
      subscriptionId: result.subscription.id,
      invoiceId: result.invoiceId,
      grantedMeetings: result.grantedMeetings,
    };
  }

  @Post('orgs/:tenantId/billing/force-status')
  @ApiOperation({
    summary: 'Принудительный перевод статуса (обход FSM, super_admin).',
  })
  @ApiOkResponse({ type: SubscriptionViewDto })
  @UsePipes(new ZodValidationPipe(AdminForceStatusBodySchema))
  async forceStatus(
    @Param('tenantId') tenantId: string,
    @Body() body: AdminForceStatusBody,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<SubscriptionViewBody> {
    const sub = await this.manual.forceStatus({
      tenantId,
      newStatus: body.newStatus,
      reason: body.reason,
      byUserId: user.id,
    });
    return this.toSubscriptionView(sub);
  }

  @Get('orgs/:tenantId/billing/events')
  @ApiOperation({ summary: 'История событий подписки Org.' })
  async getEvents(
    @Param('tenantId') tenantId: string,
  ): Promise<{
    items: Array<{
      id: string;
      eventType: string;
      payload: unknown;
      byUserId: string | null;
      reason: string | null;
      createdAt: string;
    }>;
  }> {
    const sub = await this.subscriptions.getByTenant(tenantId);
    if (!sub) return { items: [] };
    const events = await this.prisma.subscriptionEvent.findMany({
      where: { subscriptionId: sub.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return {
      items: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        payload: e.payload,
        byUserId: e.byUserId,
        reason: e.reason,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  // ──────────────────── Инвойсы ────────────────────

  @Post('billing/invoices/:id/mark-paid')
  @ApiOperation({
    summary: 'Отметить инвойс оплаченным (по банковскому переводу).',
  })
  @ApiOkResponse({ type: InvoiceViewDto })
  @UsePipes(new ZodValidationPipe(AdminMarkPaidBodySchema))
  async markInvoicePaid(
    @Param('id') invoiceId: string,
    @Body() body: AdminMarkPaidBody,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<InvoiceViewBody> {
    const inv = await this.invoices.findOrFail(invoiceId);
    const paid = await this.invoices.markPaid({
      invoiceId: inv.id,
      paymentMode: 'paid',
      byUserId: user.id,
      externalRef: body.externalRef ?? body.reason,
    });
    await this.prisma.adminAuditLog.create({
      data: {
        actorId: user.id,
        action: 'billing.invoice.mark_paid',
        targetType: 'invoice',
        targetId: paid.id,
        payload: {
          tenantId: paid.tenantId,
          reason: body.reason,
          externalRef: body.externalRef ?? null,
        },
      },
    });
    return this.toInvoiceView(paid);
  }

  @Post('billing/invoices/:id/void')
  @ApiOperation({ summary: 'Отменить инвойс (только из draft/issued).' })
  @ApiOkResponse({ type: InvoiceViewDto })
  @UsePipes(new ZodValidationPipe(AdminVoidInvoiceBodySchema))
  async voidInvoice(
    @Param('id') invoiceId: string,
    @Body() body: AdminVoidInvoiceBody,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<InvoiceViewBody> {
    const voided = await this.invoices.void({
      invoiceId,
      reason: body.reason,
      byUserId: user.id,
    });
    if (!voided) {
      throw new NotFoundException(`Invoice ${invoiceId} не найден`);
    }
    await this.prisma.adminAuditLog.create({
      data: {
        actorId: user.id,
        action: 'billing.invoice.void',
        targetType: 'invoice',
        targetId: voided.id,
        payload: { tenantId: voided.tenantId, reason: body.reason },
      },
    });
    return this.toInvoiceView(voided);
  }

  // ──────────────────────── helpers ────────────────────────

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
    status: 'draft' | 'issued' | 'paid' | 'bonus' | 'void';
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
