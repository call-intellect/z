/**
 * ReferralsController — кабинет реферала.
 *
 * Маршруты (под /api/v1/referrals/*, auth required):
 *   GET    /referrals/me              — мой профиль (или null)
 *   POST   /referrals/me              — создать профиль
 *   PATCH  /referrals/me              — обновить (inn/legalForm/payoutDetails)
 *   POST   /referrals/me/verify-inn   — запустить InnLookup verification
 *   POST   /referrals/me/accept-contract — принять оферту
 *   GET    /referrals/me/clients      — список приведённых клиентов
 *   GET    /referrals/me/payouts      — все мои начисления
 *   GET    /referrals/me/stats        — агрегированная статистика
 *   POST   /referrals/attribute-current-org — резолв атрибуции для текущей Org
 *                                            (фронт зовёт после signup)
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §11.2.
 */

import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Ip,
  NotFoundException,
  Patch,
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
import { Prisma, type Referral } from '@prisma/client';

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
  ReferralStatsDto,
  ReferralViewDto,
  UpdateReferralBodySchema,
  type CreateReferralBody,
  type ReferralStatsBody,
  type ReferralViewBody,
  type UpdateReferralBody,
} from '../dto/referrals.dto';
import { AttributionService } from '../services/attribution.service';
import { ReferralPayoutService } from '../services/referral-payout.service';
import { ReferralsService } from '../services/referrals.service';

@ApiTags('referrals')
@ApiBearerAuth()
@Controller('api/v1/referrals')
@UseGuards(CookieAuthGuard)
export class ReferralsController {
  constructor(
    @Inject(ReferralsService) private readonly referrals: ReferralsService,
    @Inject(AttributionService) private readonly attribution: AttributionService,
    @Inject(ReferralPayoutService) private readonly payouts: ReferralPayoutService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Мой реферальный профиль (или null если не создан).' })
  @ApiOkResponse({ type: ReferralViewDto })
  async getMe(@CurrentUser() user: CurrentUserPayload): Promise<ReferralViewBody | null> {
    const ref = await this.referrals.getByUserId(user.id);
    return ref ? this.toView(ref) : null;
  }

  @Post('me')
  @ApiOperation({ summary: 'Создать реферальный профиль.' })
  @ApiOkResponse({ type: ReferralViewDto })
  @UsePipes(new ZodValidationPipe(CreateReferralBodySchema))
  async create(
    @Body() body: CreateReferralBody,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ReferralViewBody> {
    const ref = await this.referrals.create({
      ownerUserId: user.id,
      inn: body.inn,
      legalForm: body.legalForm,
      payoutDetails: body.payoutDetails as Prisma.InputJsonValue,
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
  @ApiOperation({ summary: 'Список приведённых клиентов.' })
  async listClients(@CurrentUser() user: CurrentUserPayload) {
    const ref = await this.referrals.getByUserId(user.id);
    if (!ref) return [];
    return this.referrals.listClients(ref.id);
  }

  @Get('me/payouts')
  @ApiOperation({ summary: 'Список моих начислений.' })
  async listMyPayouts(@CurrentUser() user: CurrentUserPayload) {
    const ref = await this.referrals.getByUserId(user.id);
    if (!ref) return [];
    return this.referrals.listPayouts(ref.id);
  }

  @Get('me/stats')
  @ApiOperation({ summary: 'Агрегированная статистика по моим клиентам.' })
  @ApiOkResponse({ type: ReferralStatsDto })
  async stats(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ReferralStatsBody | null> {
    const ref = await this.referrals.getByUserId(user.id);
    if (!ref) return null;
    return this.referrals.getStats(ref.id);
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
      inn: ref.inn,
      innVerifiedAt: ref.innVerifiedAt?.toISOString() ?? null,
      legalForm: ref.legalForm,
      contractAcceptedAt: ref.contractAcceptedAt?.toISOString() ?? null,
      createdAt: ref.createdAt.toISOString(),
    };
  }
}
