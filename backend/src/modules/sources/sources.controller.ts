import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { EntitlementService } from '../entitlements/entitlement.service';
import type { FeatureKey } from '../entitlements/tier-config';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import {
  SourceCreateSchema,
  SourceListQuerySchema,
  SourceUpdateSchema,
  type SourceCreateDto,
  type SourceListQuery,
  type SourceListResponseDto,
  type SourceResponseDto,
  type SourceTestResultDto,
  type SourceUpdateDto,
} from './dto/source.dto';
import { SourcesService } from './sources.service';

@ApiTags('sources')
@Controller('api/v1/sources')
@UseGuards(CookieAuthGuard, TenantGuard)
export class SourcesController {
  constructor(
    @Inject(SourcesService) private readonly sources: SourcesService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(EntitlementService) private readonly entitlements: EntitlementService,
  ) {}

  private featureForType(type: string): FeatureKey | null {
    switch (type) {
      case 'bot':
        return 'feature.adapter_telegram';
      case 'email':
        return 'feature.adapter_email';
      case 'phone_call':
        return 'feature.adapter_call';
      case 'web_form':
        return 'feature.adapter_web_form';
      default:
        return null;
    }
  }

  @Get()
  @ApiOperation({ summary: 'Список источников Org (фильтр по type)' })
  async list(
    @Query(new ZodValidationPipe(SourceListQuerySchema)) q: SourceListQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<SourceListResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.sources.list(t, q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить источник по id' })
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<SourceResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.sources.get(t, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Создать источник (owner/admin)' })
  async create(
    @Body(new ZodValidationPipe(SourceCreateSchema)) body: SourceCreateDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<SourceResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireManage(user.id, t);

    const requiredFeature = this.featureForType(body.type);
    if (requiredFeature) {
      const allowed = await this.entitlements.hasFeature(t, requiredFeature);
      if (!allowed) {
        const ent = await this.entitlements.getEntitlement(t);
        throw new ForbiddenException({
          ok: false,
          error: {
            code: 'entitlement_required',
            message: `Адаптер '${body.type}' не входит в тариф ${ent.tier}.`,
            feature: requiredFeature,
            currentTier: ent.tier,
            upgradeUrl: '/settings/billing',
          },
        });
      }
    }

    return this.sources.create(t, user.id, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить источник' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SourceUpdateSchema)) body: SourceUpdateDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<SourceResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireManage(user.id, t);
    return this.sources.update(t, user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete (isActive=false)' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    await this.requireDelete(user.id, t);
    return this.sources.softDelete(t, user.id, id);
  }

  @Delete(':id/purge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Полное удаление источника + его RawEvent (необратимо)' })
  async purge(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; deletedRawEvents: number }> {
    const t = this.requireTenant(tenantId);
    await this.requireDelete(user.id, t);
    return this.sources.hardDelete(t, user.id, id);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Smoke-test адаптера' })
  async test(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<SourceTestResultDto> {
    const t = this.requireTenant(tenantId);
    await this.requireManage(user.id, t);
    return this.sources.test(t, user.id, id);
  }

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    return tenantId;
  }

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'source');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Нет прав на чтение источников' },
      });
    }
  }

  private async requireManage(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'source',
      act: 'manage',
    });
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Изменять источники может только владелец или администратор Org',
        },
      });
    }
  }

  private async requireDelete(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'source',
      act: 'delete',
    });
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Удаление источников доступно только владельцу Org',
        },
      });
    }
  }
}
