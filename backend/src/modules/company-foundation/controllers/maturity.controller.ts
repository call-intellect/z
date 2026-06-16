import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import {
  type MaturityOverviewDto,
  MaturityScopeSchema,
  type MaturityScope,
  type MaturityScopeDetailDto,
  type RebuildMaturityResponseDto,
} from '../dto/maturity.dto';
import { MaturityScorerService } from '../services/maturity-scorer.service';

@ApiTags('maturity')
@Controller('api/v1/maturity')
@UseGuards(CookieAuthGuard, TenantGuard)
export class MaturityController {
  constructor(
    @Inject(MaturityScorerService)
    private readonly svc: MaturityScorerService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'Сводка по зрелости компании' })
  async overview(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<MaturityOverviewDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.overview(t);
  }

  @Get('scope/:scope/:id')
  @ApiOperation({ summary: 'Детализация maturity по одной сущности' })
  async scope(
    @Param('scope') scope: string,
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<MaturityScopeDetailDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    const parsed = MaturityScopeSchema.safeParse(scope);
    if (!parsed.success) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'invalid_scope',
          message: 'scope ∈ {role|department|company}',
        },
      });
    }
    try {
      return await this.svc.scopeDetail({
        tenantId: t,
        scope: parsed.data as MaturityScope,
        id,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'NotFoundError') {
        throw new NotFoundException({
          ok: false,
          error: { code: 'unit_not_found', message: err.message },
        });
      }
      throw err;
    }
  }

  @Post('rebuild')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Ручной триггер пересчёта зрелости (admin)' })
  async rebuild(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<RebuildMaturityResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRebuild(user.id, t);
    return this.svc.rebuildForTenant({ tenantId: t });
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
    const ok = await this.rbac.canRead(userId, tenantId, 'maturity');
    if (!ok) throw this.forbidden('Недостаточно прав для просмотра зрелости');
  }

  private async requireRebuild(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'maturity',
      act: 'manage',
    });
    if (!ok) throw this.forbidden('Пересчёт зрелости доступен только владельцу/администратору Org');
  }

  private forbidden(message: string): ForbiddenException {
    return new ForbiddenException({
      ok: false,
      error: { code: 'forbidden', message },
    });
  }
}
