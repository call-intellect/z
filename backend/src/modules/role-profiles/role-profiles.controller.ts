import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import {
  ListRoleProfilesQuerySchema,
  type ListRoleProfilesQuery,
  type RoleProfileBuildStatusDto,
  type RoleProfileDetailDto,
  type RoleProfileListItemDto,
  type RoleProfileRebuildResponseDto,
} from './dto/role-profiles.dto';
import { RoleProfilesService } from './services/role-profiles.service';

@ApiTags('role-profiles')
@Controller('api/v1/role-profiles')
@UseGuards(CookieAuthGuard, TenantGuard)
export class RoleProfilesController {
  constructor(
    @Inject(RoleProfilesService) private readonly svc: RoleProfilesService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список карт должностей Org' })
  async list(
    @Query(new ZodValidationPipe(ListRoleProfilesQuerySchema))
    q: ListRoleProfilesQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: RoleProfileListItemDto[]; total: number }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.list({ tenantId: t, status: q.status, limit: q.limit });
  }

  @Get(':roleId')
  @ApiOperation({ summary: 'Карта конкретной должности (по roleId)' })
  async byRoleId(
    @Param('roleId') roleId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<RoleProfileDetailDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.getByRoleId({ tenantId: t, roleId });
  }

  @Post(':roleId/rebuild')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Заказать пересборку карты должности (owner/admin)' })
  async rebuild(
    @Param('roleId') roleId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<RoleProfileRebuildResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRebuild(user.id, t);
    return this.svc.rebuild({ tenantId: t, userId: user.id, roleId });
  }

  @Get(':roleId/build-status')
  @ApiOperation({ summary: 'Статус сборки карты должности (poll)' })
  async buildStatus(
    @Param('roleId') roleId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<RoleProfileBuildStatusDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.buildStatus({ tenantId: t, roleId });
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
    const ok = await this.rbac.canRead(userId, tenantId, 'role-profile');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав для чтения карт должностей' },
      });
    }
  }

  private async requireRebuild(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'role-profile');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Запускать пересборку карты должности может только владелец/администратор Org',
        },
      });
    }
  }
}
