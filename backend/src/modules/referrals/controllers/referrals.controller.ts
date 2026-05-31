/**
 * ReferralsController — кабинет партнёра.
 *
 * Маршруты (под /api/v1/referrals/*, auth required):
 *   GET    /referrals/me                — мой профиль (или null)
 *   POST   /referrals/me                — создать профиль (contractAccepted + опц. реквизиты)
 *   PATCH  /referrals/me                — обновить (inn/legalForm/payoutDetails)
 *   POST   /referrals/me/verify-inn     — запустить InnLookup verification
 *   POST   /referrals/me/accept-contract — принять оферту (legacy; в новом флоу
 *                                          оферта принимается при create)
 *   GET    /referrals/me/clients        — список приведённых клиентов (маскированный)
 *   GET    /referrals/me/payouts        — все мои начисления
 *   GET    /referrals/me/stats          — расширенная статистика (legacy 5 + 5 новых)
 *   GET    /referrals/me/income-chart   — 12 месяцев доход + активные клиенты
 *   GET    /referrals/me/funnel         — воронка за период (30d/90d/all)
 *   POST   /referrals/me/promo-event    — трекинг ReferralPromoStrip
 *                                          (impression/click/dismissed, 30/min/IP)
 *   POST   /referrals/attribute-current-org — резолв атрибуции для текущей Org
 *                                            (фронт зовёт после signup)
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §11.2 +
 * plans/tz/2026-05-31-referrals-cabinet-revamp.md §7.5, §7.6, §8.3a.
 */

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Ip,
  NotFoundException,
  Patch,
  Post,
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Prisma, type Referral } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import {
  CreateReferralBodySchema,
  FunnelDto,
  FunnelQuerySchema,
  MonthlyPointDto,
  PromoEventBodySchema,
  ReferralClientMaskedDto,
  ReferralStatsExtendedDto,
  ReferralViewDto,
  UpdateReferralBodySchema,
  type CreateReferralBody,
  type FunnelBody,
  type FunnelQuery,
  type MonthlyPointBody,
  type PromoEventBody,
  type ReferralClientMaskedBody,
  type ReferralStatsExtendedBody,
  type ReferralViewBody,
  type UpdateReferralBody,
} from '../dto/referrals.dto';
import { AttributionService } from '../services/attribution.service';
import { ReferralPayoutService } from '../services/referral-payout.service';
import {
  ReferralsService,
  type Funnel as FunnelView,
  type MonthlyPoint as MonthlyPointView,
  type ReferralClientMaskedView,
  type ReferralStatsExtended,
} from '../services/referrals.service';

@ApiTags('referrals')
@ApiBearerAuth()
@Controller('api/v1/referrals')
@UseGuards(CookieAuthGuard)
export class ReferralsController {
  constructor(
    @Inject(ReferralsService) private readonly referrals: ReferralsService,
    @Inject(AttributionService) private readonly attribution: AttributionService,
    @Inject(ReferralPayoutService) private readonly payouts: ReferralPayoutService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Мой реферальный профиль (или null если не создан).' })
  @ApiOkResponse({ type: ReferralViewDto })
  async getMe(@CurrentUser() user: CurrentUserPayload): Promise<ReferralViewBody | null> {
    const ref = await this.referrals.getByUserId(user.id);
    return ref ? this.toView(ref) : null;
  }

  @Post('me')
  @ApiOperation({
    summary:
      'Создать партнёрский профиль. Достаточно contractAccepted=true (реквизиты — позже).',
  })
  @ApiOkResponse({ type: ReferralViewDto })
  @UsePipes(new ZodValidationPipe(CreateReferralBodySchema))
  async create(
    @Body() body: CreateReferralBody,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ReferralViewBody> {
    const ref = await this.referrals.create({
      ownerUserId: user.id,
      contractAccepted: body.contractAccepted,
      inn: body.inn,
      legalForm: body.legalForm,
      payoutDetails:
        body.payoutDetails !== undefined
          ? (body.payoutDetails as Prisma.InputJsonValue)
          : undefined,
    });
    return this.toView(ref);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Обновить inn / legalForm / payoutDetails.' })
  @ApiOkResponse({ type: ReferralViewDto })
  @UsePipes(new ZodValidationPipe(UpdateReferralBodySchema))
  async update(
    @Body() body: UpdateReferralBody,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ReferralViewBody> {
    const ref = await this.referrals.update(user.id, {
      inn: body.inn,
      legalForm: body.legalForm,
      payoutDetails: body.payoutDetails as Prisma.InputJsonValue | undefined,
    });
    return this.toView(ref);
  }

  @Post('me/verify-inn')
  @ApiOperation({ summary: 'Верифицировать ИНН через InnLookupService.' })
  @ApiOkResponse({ type: ReferralViewDto })
  async verifyInn(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ReferralViewBody> {
    const ref = await this.referrals.verifyInn(user.id);
    return this.toView(ref);
  }

  @Post('me/accept-contract')
  @ApiOperation({ summary: 'Принять оферту реферальной программы.' })
  @ApiOkResponse({ type: ReferralViewDto })
  async acceptContract(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ReferralViewBody> {
    const ref = await this.referrals.acceptContract(user.id);
    return this.toView(ref);
  }

  @Get('me/clients')
  @ApiOperation({
    summary:
      'Список приведённых клиентов (маскированный — без названия Org и id).',
  })
  @ApiOkResponse({ type: ReferralClientMaskedDto, isArray: true })
  async listClients(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ReferralClientMaskedBody[]> {
    const ref = await this.referrals.getByUserId(user.id);
    if (!ref) return [];
    const views = await this.referrals.listClients(ref.id);
    return views.map(toMaskedClientBody);
  }

  @Get('me/payouts')
  @ApiOperation({ summary: 'Список моих начислений.' })
  async listMyPayouts(@CurrentUser() user: CurrentUserPayload) {
    const ref = await this.referrals.getByUserId(user.id);
    if (!ref) return [];
    return this.referrals.listPayouts(ref.id);
  }

  @Get('me/stats')
  @ApiOperation({
    summary:
      'Расширенная статистика партнёра (legacy 5 полей + клики/регистрации/конверсии за 30 дней).',
  })
  @ApiOkResponse({ type: ReferralStatsExtendedDto })
  async stats(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ReferralStatsExtendedBody | null> {
    const ref = await this.referrals.getByUserId(user.id);
    if (!ref) return null;
    const stats = await this.referrals.getStats(ref.id);
    return toStatsExtendedBody(stats);
  }

  @Get('me/income-chart')
  @ApiOperation({
    summary:
      'График дохода и активных клиентов: 12 точек за последние 12 месяцев (UTC).',
  })
  @ApiOkResponse({ type: MonthlyPointDto, isArray: true })
  async incomeChart(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<MonthlyPointBody[]> {
    const ref = await this.referrals.getByUserId(user.id);
    if (!ref) return [];
    const points = await this.referrals.getIncomeChart(ref.id);
    return points.map(toMonthlyPointBody);
  }

  @Get('me/funnel')
  @ApiOperation({
    summary:
      'Воронка партнёра за период: клики → регистрации → первые оплаты → активные сейчас.',
  })
  @ApiQuery({
    name: 'period',
    enum: ['30d', '90d', 'all'],
    required: false,
    description: 'Период фильтрации. По умолчанию 30d.',
  })
  @ApiOkResponse({ type: FunnelDto })
  async funnel(
    @CurrentUser() user: CurrentUserPayload,
    @Query(new ZodValidationPipe(FunnelQuerySchema)) query: FunnelQuery,
  ): Promise<FunnelBody | null> {
    const ref = await this.referrals.getByUserId(user.id);
    if (!ref) return null;
    const funnel = await this.referrals.getFunnel(ref.id, query.period);
    return toFunnelBody(funnel);
  }

  /**
   * Трекинг событий промо-полосы `<ReferralPromoStrip />` в `AppShell`
   * (ТЗ referrals-cabinet-revamp §8.3a). Никакой бизнес-логики и записи
   * в БД — только инкремент Prometheus-counter'а. Throttle 30/min/IP —
   * защита от шумных клиентов / случайных циклов ререндера.
   *
   * Body:
   *   - `type` = `impression` (первый показ за сессию) | `click` |
   *     `dismissed`.
   *   - `role` = `owner` | `member` — фронт сам определяет роль
   *     текущего пользователя в Org и присылает её для аналитики
   *     (конверсия по сегментам различается).
   *
   * Ответ — 204 No Content.
   */
  @Post('me/promo-event')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UsePipes(new ZodValidationPipe(PromoEventBodySchema))
  @ApiOperation({
    summary:
      'Трекинг промо-полосы рефералки (impression / click / dismissed). 204 без тела.',
  })
  @ApiNoContentResponse({ description: 'Метрика инкрементирована.' })
  trackPromoEvent(@Body() body: PromoEventBody): void {
    switch (body.type) {
      case 'impression':
        this.metrics.incReferralPromoImpression({ role: body.role });
        break;
      case 'click':
        this.metrics.incReferralPromoClick({ role: body.role });
        break;
      case 'dismissed':
        this.metrics.incReferralPromoDismissed({ role: body.role });
        break;
    }
  }

  /**
   * После регистрации Org фронт зовёт этот эндпоинт чтобы привязать
   * cookie/fingerprint к Org. Резолвит атрибуцию по cookie z_ref
   * (передаётся как `X-Z-Ref` заголовок, потому что cookie может не
   * долететь в API-домен) и/или fingerprint.
   */
  @Post('attribute-current-org')
  @ApiOperation({
    summary:
      'Привязать атрибуцию к текущей Org (фронт зовёт сразу после signup).',
  })
  // audit-fixes Б14: TenantGuard валидирует X-Org-Id и проверяет, что
  // юзер действительно member этой Org. Без него можно было передать
  // X-Org-Id чужого тенанта и навязать ему реферера → 20 000 ₽ × 12 мес.
  @UseGuards(TenantGuard)
  async attributeCurrentOrg(
    @Headers('x-z-ref') xZRef: string | undefined,
    @Headers('x-z-fingerprint') xFingerprint: string | undefined,
    @CurrentOrg() tenantId: string | undefined,
    @Ip() ip: string,
  ): Promise<{ attributed: boolean; slug: string | null }> {
    if (!tenantId) {
      // TenantGuard уже отверг бы запрос без tenantId/без membership,
      // но defense-in-depth — оставляем явный 404.
      throw new NotFoundException('Не определён tenantId (нужен X-Org-Id)');
    }
    const resolved = await this.attribution.attributeOrg({
      tenantId,
      cookieSlug: xZRef ?? null,
      fingerprint: xFingerprint ?? null,
      ip,
    });
    return {
      attributed: resolved !== null,
      slug: resolved?.slug ?? null,
    };
  }

  // ──────────────────────── helpers ────────────────────────

  private toView(ref: Referral): ReferralViewBody {
    return {
      id: ref.id,
      slug: ref.slug,
      // ТЗ referrals-cabinet-revamp §5.1: inn / legalForm теперь nullable.
      inn: ref.inn ?? null,
      innVerifiedAt: ref.innVerifiedAt?.toISOString() ?? null,
      legalForm: ref.legalForm ?? null,
      contractAcceptedAt: ref.contractAcceptedAt?.toISOString() ?? null,
      createdAt: ref.createdAt.toISOString(),
    };
  }
}

// ──────────────────────── module-level mappers ────────────────────────

function toMaskedClientBody(view: ReferralClientMaskedView): ReferralClientMaskedBody {
  return {
    clientCode: view.clientCode,
    attachedAt: view.attachedAt.toISOString(),
    firstPaidAt: view.firstPaidAt?.toISOString() ?? null,
    status: view.status,
    monthlyEarningsKopecks: view.monthlyEarningsKopecks,
    totalEarnedKopecks: view.totalEarnedKopecks,
  };
}

function toStatsExtendedBody(stats: ReferralStatsExtended): ReferralStatsExtendedBody {
  return {
    totalClients: stats.totalClients,
    activePaying: stats.activePaying,
    totalEarnedKopecks: stats.totalEarnedKopecks,
    totalPaidKopecks: stats.totalPaidKopecks,
    totalPendingKopecks: stats.totalPendingKopecks,
    clicks30d: stats.clicks30d,
    signups30d: stats.signups30d,
    firstPayments30d: stats.firstPayments30d,
    conversionClickToPaidPercent: stats.conversionClickToPaidPercent,
    conversionSignupToPaidPercent: stats.conversionSignupToPaidPercent,
  };
}

function toMonthlyPointBody(point: MonthlyPointView): MonthlyPointBody {
  return {
    month: point.month,
    incomeRub: point.incomeRub,
    activeClients: point.activeClients,
  };
}

function toFunnelBody(funnel: FunnelView): FunnelBody {
  return {
    period: funnel.period,
    clicks: funnel.clicks,
    signups: funnel.signups,
    firstPayments: funnel.firstPayments,
    activeNow: funnel.activeNow,
    conversions: {
      clickToSignupPercent: funnel.conversions.clickToSignupPercent,
      signupToPaidPercent: funnel.conversions.signupToPaidPercent,
      clickToPaidPercent: funnel.conversions.clickToPaidPercent,
    },
  };
}
