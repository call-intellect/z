/**
 * AdminReferralsController — управление рефералами и payout'ами (super_admin).
 *
 * Маршруты (под /api/v1/admin/referrals/*, super_admin only):
 *   GET   /admin/referrals               — список всех рефералов
 *   GET   /admin/referrals/:id           — карточка реферала + клиенты + payouts
 *   GET   /admin/referrals/payouts       — все payouts с фильтрами status/period
 *   POST  /admin/referrals/payouts/:id/mark-paid
 *   POST  /admin/referrals/payouts/:id/void
 *   POST  /admin/referrals/close-period  — ручное закрытие периода (для отладки cron)
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
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { ReferralPayoutStatus } from '@prisma/client';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import {
  AdminClosePeriodBodySchema,
  AdminMarkPayoutPaidBodySchema,
  AdminVoidPayoutBodySchema,
  type AdminClosePeriodBody,
  type AdminMarkPayoutPaidBody,
  type AdminVoidPayoutBody,
} from '../dto/referrals.dto';
import { ReferralPayoutService } from '../services/referral-payout.service';
import { ReferralsService } from '../services/referrals.service';

@ApiTags('admin-referrals')
@ApiBearerAuth()
@Controller('api/v1/admin/referrals')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
export class AdminReferralsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ReferralsService) private readonly referrals: ReferralsService,
    @Inject(ReferralPayoutService)
    private readonly payouts: ReferralPayoutService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список всех рефералов.' })
  async list(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const items = await this.prisma.referral.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit ? Number(limit) : 50,
      skip: offset ? Number(offset) : 0,
      include: {
        owner: { select: { id: true, email: true, name: true } },
      },
    });
    return { items };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Карточка реферала.' })
  async detail(@Param('id') id: string) {
    const ref = await this.prisma.referral.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, email: true, name: true } },
      },
    });
    if (!ref) throw new NotFoundException(`Referral ${id} не найден`);
    const [clients, payouts, stats] = await Promise.all([
      this.referrals.listClients(id),
      this.referrals.listPayouts(id),
      this.referrals.getStats(id),
    ]);
    return { referral: ref, clients, payouts, stats };
  }

  @Get('payouts')
  @ApiOperation({ summary: 'Список payouts с фильтрами status/periodMonth.' })
  async listPayouts(
    @Query('status') status?: ReferralPayoutStatus,
    @Query('periodMonth') periodMonth?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.payouts.list({
      status,
      periodMonth,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Post('payouts/:id/mark-paid')
  @ApiOperation({
    summary: 'Пометить payout как оплаченный (после реального перевода).',
  })
  @UsePipes(new ZodValidationPipe(AdminMarkPayoutPaidBodySchema))
  async markPaid(
    @Param('id') id: string,
    @Body() body: AdminMarkPayoutPaidBody,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const payout = await this.payouts.markPaidByAdmin({
      payoutId: id,
      payoutDocumentUrl: body.payoutDocumentUrl ?? null,
    });
    await this.prisma.adminAuditLog.create({
      data: {
        actorId: user.id,
        action: 'referrals.payout.mark_paid',
        targetType: 'referral_payout',
        targetId: payout.id,
        payload: {
          referralId: payout.referralId,
          amountKopecks: payout.amountKopecks,
          documentUrl: body.payoutDocumentUrl ?? null,
        },
      },
    });
    return payout;
  }

  @Post('payouts/:id/void')
  @ApiOperation({ summary: 'Аннулировать payout.' })
  @UsePipes(new ZodValidationPipe(AdminVoidPayoutBodySchema))
  async voidPayout(
    @Param('id') id: string,
    @Body() body: AdminVoidPayoutBody,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const payout = await this.payouts.voidByAdmin({
      payoutId: id,
      voidReason: body.voidReason,
    });
    await this.prisma.adminAuditLog.create({
      data: {
        actorId: user.id,
        action: 'referrals.payout.void',
        targetType: 'referral_payout',
        targetId: payout.id,
        payload: {
          referralId: payout.referralId,
          voidReason: body.voidReason,
        },
      },
    });
    return payout;
  }

  @Post('close-period')
  @ApiOperation({
    summary: 'Ручное закрытие периода (для отладки cron-задачи).',
  })
  @UsePipes(new ZodValidationPipe(AdminClosePeriodBodySchema))
  async closePeriod(
    @Body() body: AdminClosePeriodBody,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const result = await this.payouts.closePeriod(body.periodMonth);
    await this.prisma.adminAuditLog.create({
      data: {
        actorId: user.id,
        action: 'referrals.close_period',
        targetType: 'referral_period',
        targetId: body.periodMonth,
        payload: { ...result, periodMonth: body.periodMonth },
      },
    });
    return result;
  }
}
