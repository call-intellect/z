import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';

import {
  type HelpfulnessSpotlightDto,
  type HelpfulnessTraitDto,
  ListSpotlightsQuerySchema,
  type ListSpotlightsQuery,
  type ListSpotlightsResponse,
  type SocialContributionProfileDto,
} from '../dto/helpfulness.dto';
import { HelpfulnessApiService } from '../services/helpfulness-api.service';

/**
 * SBA Wave 2 — REST API Specialist 3.8 (Helpfulness Agent) — user-facing.
 *
 *   GET    /api/v1/me/social-contribution                        — мой профиль (ВСЁ).
 *   GET    /api/v1/persons/:id/social-contribution               — для руководителя/самого: public-traits.
 *   GET    /api/v1/feed/spotlights                               — публичная лента (status=published).
 *   POST   /api/v1/feed/spotlights/:id/approve                   — одобрение руководителем.
 *   POST   /api/v1/feed/spotlights/:id/hide                      — скрыть.
 *   POST   /api/v1/feed/spotlights/:id/republish                 — пере-опубликовать.
 *   POST   /api/v1/me/social-contribution/traits/:id/mark-as-misleading — пометить как ошибку.
 *
 * RBAC:
 *   - social_contribution_profile / helpfulness_spotlight — `canRead` все
 *     member'ы Org (так же как Idea).
 *   - approve/hide/republish — `canWrite` (owner/admin/руководитель).
 *   - mark-as-misleading — только владелец trait'а (внутри сервиса).
 */
@ApiTags('helpfulness')
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class HelpfulnessController {
  constructor(
    @Inject(HelpfulnessApiService) private readonly svc: HelpfulnessApiService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  // ────────────── Social contribution profile ──────────────

  @Get('me/social-contribution')
  @ApiOperation({ summary: 'Мой профиль социального вклада (полная картина)' })
  async getMyProfile(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{
    profile: SocialContributionProfileDto | null;
    recentTraits: HelpfulnessTraitDto[];
  }> {
    const t = this.requireTenant(tenantId);
    return this.svc.getMyProfile({ tenantId: t, userId: user.id });
  }

  @Get('persons/:id/social-contribution')
  @ApiOperation({
    summary: 'Профиль социального вклада человека (только public-trait\'ы)',
  })
  async getPersonProfile(
    @Param('id') targetUserId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{
    profile: SocialContributionProfileDto | null;
    publicTraits: HelpfulnessTraitDto[];
  }> {
    const t = this.requireTenant(tenantId);
    // Только сам пользователь, admin, или руководитель команды.
    if (user.id !== targetUserId) {
      await this.requireRead(user.id, t);
    }
    return this.svc.getProfileForPerson({
      tenantId: t,
      targetUserId,
    });
  }

  // ────────────── Spotlights ──────────────

  @Get('feed/spotlights')
  @ApiOperation({ summary: 'Публичная лента «Спасибо команде»' })
  async listSpotlights(
    @Query(new ZodValidationPipe(ListSpotlightsQuerySchema))
    q: ListSpotlightsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListSpotlightsResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);

    // Любой member'у НЕ показываем status=pending/approved/hidden —
    // только published. Pending — privilege руководителя.
    const effectiveQuery: ListSpotlightsQuery =
      q.status === 'published'
        ? q
        : await this.guardSpotlightStatus({
            userId: user.id,
            tenantId: t,
            q,
          });

    return this.svc.listSpotlights({ tenantId: t, query: effectiveQuery });
  }

  @Post('feed/spotlights/:id/approve')
  @ApiOperation({ summary: 'Одобрить spotlight (руководитель/admin)' })
  async approveSpotlight(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; spotlight: HelpfulnessSpotlightDto }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.approveSpotlight({
      tenantId: t,
      spotlightId: id,
      approvedByUserId: user.id,
    });
  }

  @Post('feed/spotlights/:id/hide')
  @ApiOperation({ summary: 'Скрыть spotlight' })
  async hideSpotlight(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.hideSpotlight({ tenantId: t, spotlightId: id });
  }

  @Post('feed/spotlights/:id/republish')
  @ApiOperation({ summary: 'Пере-опубликовать ранее скрытый spotlight' })
  async republishSpotlight(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; spotlight: HelpfulnessSpotlightDto }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.republishSpotlight({
      tenantId: t,
      spotlightId: id,
      approvedByUserId: user.id,
    });
  }

  // ────────────── Mark-as-misleading ──────────────

  @Post('me/social-contribution/traits/:id/mark-as-misleading')
  @ApiOperation({ summary: 'Пометить trait как ошибочный (только для своих)' })
  async markAsMisleading(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    return this.svc.markTraitAsMisleading({
      tenantId: t,
      traitId: id,
      userId: user.id,
    });
  }

  // ────────────── Helpers ──────────────

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'tenant_required',
          message: 'Организация не определена',
        },
      });
    }
    return tenantId;
  }

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(
      userId,
      tenantId,
      'social_contribution_profile',
    );
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для чтения профиля социального вклада',
        },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(
      userId,
      tenantId,
      'helpfulness_spotlight',
    );
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message:
            'Только руководитель или admin могут одобрять/скрывать spotlight',
        },
      });
    }
  }

  /**
   * Если member запрашивает status ≠ published — проверяем canWrite (доступ
   * к pending у руководителя/admin); иначе принудительно ставим published.
   */
  private async guardSpotlightStatus(args: {
    userId: string;
    tenantId: string;
    q: ListSpotlightsQuery;
  }): Promise<ListSpotlightsQuery> {
    const canWrite = await this.rbac.canWrite(
      args.userId,
      args.tenantId,
      'helpfulness_spotlight',
    );
    if (canWrite) return args.q;
    return { ...args.q, status: 'published' };
  }
}
