import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import {
  type CompanyProfileDto,
  type RebuildCompletenessResponseDto,
  UpdateCompanyProfileSchema,
  type UpdateCompanyProfileDto,
} from '../dto/company-profile.dto';
import { CompanyProfileService } from '../services/company-profile.service';

@ApiTags('company')
@Controller('api/v1/company')
@UseGuards(CookieAuthGuard, TenantGuard)
export class CompanyController {
  constructor(
    @Inject(CompanyProfileService)
    private readonly svc: CompanyProfileService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Получить профиль компании' })
  async get(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<CompanyProfileDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.getOrCreate(t);
  }

  @Patch()
  @ApiOperation({ summary: 'Обновить профиль компании (только owner/admin)' })
  async update(
    @Body(new ZodValidationPipe(UpdateCompanyProfileSchema))
    body: UpdateCompanyProfileDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<CompanyProfileDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.update({ tenantId: t, userId: user.id, body });
  }

  @Post('rebuild-completeness')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Ручной триггер пересчёта completeness CompanyProfile' })
  async rebuildCompleteness(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<RebuildCompletenessResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    const r = await this.svc.rebuildCompleteness({
      tenantId: t,
      userId: user.id,
    });
    return { ok: true as const, enqueued: r.enqueued, reason: r.reason };
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
    const ok = await this.rbac.canRead(userId, tenantId, 'company_profile');
    if (!ok) throw this.forbidden('Недостаточно прав для чтения профиля компании');
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'company_profile');
    if (!ok)
      throw this.forbidden('Изменять профиль компании может только владелец/администратор Org');
  }

  private forbidden(message: string): ForbiddenException {
    return new ForbiddenException({
      ok: false,
      error: { code: 'forbidden', message },
    });
  }
}
