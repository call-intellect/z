import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import {
  PatchEntitlementSchema,
  type EntitlementResponseDto,
  type PatchEntitlementDto,
} from './dto/entitlement.dto';
import { EntitlementService } from './entitlement.service';
import type { ResolvedEntitlement } from './entitlement.service';

/**
 * REST API entitlements (Фаза 12 knowledge-core, Шаг 7).
 *
 * Routes:
 *   - GET   /api/v1/me/entitlements                         — текущий tier + features + quotas
 *                                                             текущей Org (без `notes`).
 *   - GET   /api/v1/settings/billing                        — то же + `notes` (owner-only).
 *   - GET   /api/v1/admin/orgs/:tenantId/entitlement        — Z-Admin (super_admin).
 *   - PATCH /api/v1/admin/orgs/:tenantId/entitlement        — Z-Admin: смена tier'а / override'ов.
 *
 * Обязательное поле `reason` в PATCH — фиксируется в AuditLog для compliance.
 */
@ApiTags('entitlements')
@Controller('api/v1')
export class EntitlementsController {
  constructor(
    @Inject(EntitlementService) private readonly svc: EntitlementService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  // ─────────────────────────── /me/entitlements ───────────────────────────

  @Get('me/entitlements')
  @UseGuards(CookieAuthGuard, TenantGuard)
  @ApiOperation({ summary: 'Текущий tier + features + quotas Org пользователя' })
  async meEntitlements(
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<EntitlementResponseDto> {
    const t = this.requireTenant(tenantId);
    const ent = await this.svc.getEntitlement(t);
    return this.toDto(t, ent, /* includeNotes */ false);
  }

  // ─────────────────────────── /settings/billing ──────────────────────────

  @Get('settings/billing')
  @UseGuards(CookieAuthGuard, TenantGuard)
  @ApiOperation({ summary: 'Billing-страница owner: tier + features + quotas + notes' })
  async settingsBilling(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<EntitlementResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireOwner(user.id, t);
    const ent = await this.svc.getEntitlement(t);
    return this.toDto(t, ent, /* includeNotes */ true);
  }

  // ─────────────────────────── /admin/orgs/:tenantId/entitlement ─────────

  @Get('admin/orgs/:tenantId/entitlement')
  @UseGuards(CookieAuthGuard, SuperAdminGuard)
  @ApiOperation({ summary: 'Z-Admin: entitlement любой Org (super_admin only)' })
  async adminGet(
    @Param('tenantId') tenantId: string,
  ): Promise<EntitlementResponseDto> {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'tenantId обязателен' },
      });
    }
    const ent = await this.svc.getEntitlement(tenantId);
    return this.toDto(tenantId, ent, /* includeNotes */ true);
  }

  @Patch('admin/orgs/:tenantId/entitlement')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CookieAuthGuard, SuperAdminGuard)
  @ApiOperation({ summary: 'Z-Admin: сменить tier / override / notes (super_admin)' })
  async adminPatch(
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(PatchEntitlementSchema)) body: PatchEntitlementDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<EntitlementResponseDto> {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'tenantId обязателен' },
      });
    }

    // Применяем по полям. Каждое — отдельный AuditLog'овый event.
    if (body.tier !== undefined) {
      await this.svc.setTier(tenantId, body.tier, user.id, body.reason);
    }

    if (body.featureOverrides !== undefined) {
      for (const [key, value] of Object.entries(body.featureOverrides)) {
        await this.svc.setOverride(
          tenantId,
          'feature',
          key,
          value,
          user.id,
          body.reason,
        );
      }
    }

    if (body.quotaOverrides !== undefined) {
      for (const [key, value] of Object.entries(body.quotaOverrides)) {
        await this.svc.setOverride(
          tenantId,
          'quota',
          key,
          value,
          user.id,
          body.reason,
        );
      }
    }

    if (body.notes !== undefined) {
      await this.svc.setNotes(tenantId, body.notes);
      // notes не пишем в audit как отдельный override — это часть PATCH.
    }

    const ent = await this.svc.getEntitlement(tenantId);
    return this.toDto(tenantId, ent, /* includeNotes */ true);
  }

  // ─────────────────────────── helpers ──────────────────────────────────

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    return tenantId;
  }

  private async requireOwner(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canManageOrg(userId, tenantId);
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message:
            'Billing-страница доступна только владельцу Org или super_admin.',
        },
      });
    }
  }

  private toDto(
    tenantId: string,
    ent: ResolvedEntitlement,
    includeNotes: boolean,
  ): EntitlementResponseDto {
    const dto: EntitlementResponseDto = {
      tenantId,
      tier: ent.tier,
      rawTier: ent.rawTier,
      failedSafe: ent.failedSafe,
      features: ent.features,
      quotas: ent.quotas,
      featureOverrides: ent.featureOverrides,
      quotaOverrides: ent.quotaOverrides,
    };
    if (includeNotes) dto.notes = ent.notes;
    return dto;
  }
}
