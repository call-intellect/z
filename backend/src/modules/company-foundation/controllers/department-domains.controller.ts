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
  Post,
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
  type DepartmentDomainLinkDto,
  LinkDepartmentDomainSchema,
  type LinkDepartmentDomainDto,
} from '../dto/department-domain-link.dto';
import { DepartmentDomainLinkService } from '../services/department-domain-link.service';

/**
 * SBA α-9 wave 3 — REST API для связей Department ↔ FunctionalDomain.
 *
 *   GET    /api/v1/departments/:id/domains              — список связей отдела.
 *   POST   /api/v1/departments/:id/link-domain          — добавить связь (admin).
 *   DELETE /api/v1/departments/:id/domains/:domainId    — убрать связь (admin).
 *
 * Отдельный контроллер, чтобы не трогать существующий DepartmentsController
 * из модуля departments (α-9 wave 1).
 */
@ApiTags('departments')
@Controller('api/v1/departments')
@UseGuards(CookieAuthGuard, TenantGuard)
export class DepartmentDomainsController {
  constructor(
    @Inject(DepartmentDomainLinkService)
    private readonly svc: DepartmentDomainLinkService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get(':id/domains')
  @ApiOperation({ summary: 'Список FunctionalDomain'+"'"+'ов, привязанных к отделу' })
  async listForDepartment(
    @Param('id') departmentId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: DepartmentDomainLinkDto[] }> {
    const t = this.requireTenant(tenantId);
    await this.requireDepartmentRead(user.id, t);
    const items = await this.svc.listByDepartment({
      tenantId: t,
      departmentId,
    });
    return { items };
  }

  @Post(':id/link-domain')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Привязать FunctionalDomain к отделу (admin)' })
  async link(
    @Param('id') departmentId: string,
    @Body(new ZodValidationPipe(LinkDepartmentDomainSchema))
    body: LinkDepartmentDomainDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<DepartmentDomainLinkDto> {
    const t = this.requireTenant(tenantId);
    await this.requireDepartmentWrite(user.id, t);
    return this.svc.link({
      tenantId: t,
      userId: user.id,
      departmentId,
      body,
    });
  }

  @Delete(':id/domains/:domainId')
  @ApiOperation({ summary: 'Убрать связь Department ↔ FunctionalDomain (admin)' })
  async unlink(
    @Param('id') departmentId: string,
    @Param('domainId') domainId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    await this.requireDepartmentWrite(user.id, t);
    return this.svc.unlink({
      tenantId: t,
      userId: user.id,
      departmentId,
      domainId,
    });
  }

  // ─────────────────────────── helpers ──────────────────────────────

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    return tenantId;
  }

  private async requireDepartmentRead(
    userId: string,
    tenantId: string,
  ): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'department');
    if (!ok) throw this.forbidden('Недостаточно прав для чтения отделов');
  }

  private async requireDepartmentWrite(
    userId: string,
    tenantId: string,
  ): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'department');
    if (!ok)
      throw this.forbidden('Изменять связи отделов и доменов может только владелец/администратор');
  }

  private forbidden(message: string): ForbiddenException {
    return new ForbiddenException({
      ok: false,
      error: { code: 'forbidden', message },
    });
  }
}
